import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  LegacyCard,
  Select,
  TextField,
  Button,
  Banner,
  Text,
  Tag
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
import { useSubmit, useActionData } from "@remix-run/react";
import prisma from "../db.server";
import { metaRuleProcessor } from "../queues/metaRuleQueue.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  try {
    const type = formData.get('type');
    const pattern = formData.get('pattern');
    const description = formData.get('description');
    const name = formData.get('name');

    // Shop bilgisini al
    const shopData = await admin.graphql(`#graphql
      query {
        shop {
          id
          name
          myshopifyDomain
          email
          plan {
            displayName
          }
          contactEmail
          currencyCode
        }
      }
    `);

    const shopJson = await shopData.json();
    console.log('Shop Data:', shopJson);

    if (!shopJson?.data?.shop?.myshopifyDomain) {
      throw new Error('Shop bilgileri alınamadı');
    }

    const shopInfo = shopJson.data.shop;
    
    // Shop'u bul veya oluştur
    const shop = await prisma.shop.upsert({
      where: { 
        shopDomain: shopInfo.myshopifyDomain 
      },
      create: {
        shopDomain: shopInfo.myshopifyDomain,
        accessToken: session.accessToken,
        name: shopInfo.name,
        email: shopInfo.email,
        plan: shopInfo.plan.displayName,
        contactEmail: shopInfo.contactEmail,
        currency: shopInfo.currencyCode,
        isActive: true
      },
      update: {
        accessToken: session.accessToken,
        name: shopInfo.name,
        email: shopInfo.email,
        plan: shopInfo.plan.displayName,
        contactEmail: shopInfo.contactEmail,
        currency: shopInfo.currencyCode,
        isActive: true
      }
    });

    if (!shop?.id) {
      throw new Error('Shop kaydedilemedi');
    }

    // Yeni kuralı kaydet
    const rule = await prisma.metaRule.create({
      data: {
        name,
        type,
        pattern,
        description,
        shopId: shop.id,
        isActive: true,
        isApplied: false
      }
    });

    // admin nesnesini direkt geç
    await metaRuleProcessor.process(rule.id, admin);

    return json({
      status: "success",
      message: "Kural oluşturuldu ve uygulanmaya başlandı"
    });

  } catch (error) {
    console.error("Hata:", error);
    return json({
      status: "error",
      message: error.message
    }, { status: 500 });
  }
};

export default function MetaRules() {
  const [type, setType] = useState('product');
  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [description, setDescription] = useState('');
  const submit = useSubmit();
  const actionData = useActionData();

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append('type', type);
    formData.append('pattern', pattern);
    formData.append('name', name);
    if (type === 'product') {
      formData.append('description', description);
    }
    
    submit(formData, { method: 'post' });
  }, [type, pattern, name, description, submit]);

  const availableVariables = {
    product: [
      '{product_title}',
      '{price}',
      '{compare_at_price}',
      '{shop_name}',
      '{vendor}',
      '{sku}'
    ],
    image: [
      '{product_title}',
      '{shop_name}',
      '{image_position}'
    ]
  };

  return (
    <Page title="Meta Kuralları">
      <Layout>
        {actionData?.status && (
          <Layout.Section>
            <Banner
              title={actionData.status === "success" ? "Başarılı!" : "Hata!"}
              status={actionData.status === "success" ? "success" : "critical"}
            >
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <LegacyCard sectioned>
            <Text variant="headingMd" as="h2">Yeni Kural Oluştur</Text>
            
            <div style={{ marginTop: "1rem" }}>
              <Select
                label="Kural Tipi"
                options={[
                  { label: 'Ürün Meta Bilgileri', value: 'product' },
                  { label: 'Resim Alt Text', value: 'image' }
                ]}
                value={type}
                onChange={setType}
              />
            </div>

            <div style={{ marginTop: "1rem" }}>
              <TextField
                label="Kural Adı"
                value={name}
                onChange={setName}
                autoComplete="off"
              />
            </div>

            <div style={{ marginTop: "1rem" }}>
              <TextField
                label={type === 'product' ? 'Meta Title Şablonu' : 'Alt Text Şablonu'}
                value={pattern}
                onChange={setPattern}
                autoComplete="off"
              />
            </div>

            {type === 'product' && (
              <div style={{ marginTop: "1rem" }}>
                <TextField
                  label="Meta Description Şablonu"
                  value={description}
                  onChange={setDescription}
                  autoComplete="off"
                  helpText="Boş bırakılırsa sadece meta title güncellenir"
                />
              </div>
            )}

            <div style={{ marginTop: "1rem" }}>
              <Text variant="bodyMd" as="p">Kullanılabilir Değişkenler:</Text>
              <div style={{ marginTop: "0.5rem" }}>
                {availableVariables[type].map((variable) => (
                  <Tag key={variable} style={{ paddingRight: "10px" }}>{variable}</Tag>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "2rem" }}>
              <Button primary onClick={handleSubmit}>Kural Oluştur</Button>
            </div>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
} 