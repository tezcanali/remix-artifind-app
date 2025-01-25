import { useState } from "react";
import {
  Page,
  Layout,
  LegacyCard,
  Button,
  Banner,
  Loading,
  Grid,
  Text,
  Icon,
  DataTable
} from "@shopify/polaris";
import { authenticate, MONTHLY_PLAN, ANNUAL_PLAN } from "../shopify.server";
import { json } from "@remix-run/node";
import { useSubmit, useNavigation, useActionData, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { InventoryIcon, ImagesIcon, StarFilledIcon } from '@shopify/polaris-icons';

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);

  // Abonelik durumunu kontrol et
  const billingCheck = await billing.check({
    plans: [MONTHLY_PLAN, ANNUAL_PLAN],
    isTest: true,
  });

  // Önce shop'u bul
  const shop = await prisma.shop.findUnique({
    where: {
      shopDomain: session.shop
    }
  });

  if (!shop) {
    return json({
      totalProducts: 0,
      totalImages: 0,
      metaRules: [],
      subscriptionStatus: billingCheck
    });
  }

  // Veritabanından istatistikleri al
  const [productsCount, imagesCount, metaRules] = await Promise.all([
    // Ürün sayısı
    prisma.product.count({
      where: {
        shopId: shop.id
      }
    }),
    // Görsel sayısı
    prisma.image.count({
      where: {
        product: {
          shopId: shop.id
        }
      }
    }),
    // Son 10 meta rule
    prisma.metaRule.findMany({
      where: {
        shopId: shop.id
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    })
  ]);

  return json({
    totalProducts: productsCount,
    totalImages: imagesCount,
    metaRules: metaRules,
    subscriptionStatus: billingCheck
  });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request, {
    returnHeader: true,
    checkSession: true
  });
  
  try {
    // Session kontrolü
    if (!session?.accessToken) {
      throw new Error('Geçerli bir oturum bulunamadı');
    }

    // Shop bilgilerini almak için GraphQL sorgusunu yapalım
    const shopResponse = await admin.graphql(`
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

    const responseJson = await shopResponse.json();
    console.log('Raw GraphQL Response:', JSON.stringify(responseJson, null, 2));

    if (!responseJson?.data?.shop?.myshopifyDomain) {
      throw new Error('Shop domain bilgisi alınamadı');
    }

    const shopDomain = responseJson.data.shop.myshopifyDomain;

    try {
      // Shop kaydını oluşturalım
      const shop = await prisma.shop.upsert({
        where: { shopDomain: shopDomain },
        create: {
          shopDomain: shopDomain,
          accessToken: session.accessToken,
          name: responseJson.data.shop.name,
          email: responseJson.data.shop.email,
          plan: responseJson.data.shop.plan.displayName,
          contactEmail: responseJson.data.shop.contactEmail,
          currency: responseJson.data.shop.currencyCode,
          isActive: true
        },
        update: {
          accessToken: session.accessToken,
          isActive: true
        }
      });

      console.log('Created/Updated Shop:', shop);

      let hasNextPage = true;
      let cursor = null;
      let totalProducts = 0;

      while (hasNextPage) {
        const productsResponse = await admin.graphql(`#graphql
          query ($cursor: String) {
            products(first: 50, after: $cursor) {
              edges {
                node {
                  id
                  title
                  seo {
                    title
                    description
                  }
                  media(first: 250) {
                    edges {
                      node {
                        ... on MediaImage {
                          id
                          alt
                          mediaContentType
                          image {
                            url
                          }
                        }
                      }
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `, {
          variables: { cursor }
        });

        const productsJson = await productsResponse.json();
        const products = productsJson.data.products;

        for (const { node: product } of products.edges) {
          const shopifyId = product.id.replace('gid://shopify/Product/', '');
          
          await prisma.product.upsert({
            where: {
              shopId_shopifyId: {
                shopId: shop.id,
                shopifyId: shopifyId
              }
            },
            create: {
              shopId: shop.id,
              shopifyId: shopifyId,
              title: product.title,
              metaTitle: product.seo?.title || product.title,
              metaDescription: product.seo?.description,
              images: {
                create: product.media.edges
                  .filter(({ node }) => node.mediaContentType === 'IMAGE')
                  .map(({ node }) => ({
                    shopifyId: node.id.replace('gid://shopify/MediaImage/', ''),
                    src: node.image.url,
                    alt: node.alt
                  }))
              }
            },
            update: {
              title: product.title,
              metaTitle: product.seo?.title || product.title,
              metaDescription: product.seo?.description,
              images: {
                deleteMany: {},
                create: product.media.edges
                  .filter(({ node }) => node.mediaContentType === 'IMAGE')
                  .map(({ node }) => ({
                    shopifyId: node.id.replace('gid://shopify/MediaImage/', ''),
                    src: node.image.url,
                    alt: node.alt
                  }))
              }
            }
          });
          totalProducts++;
        }

        hasNextPage = products.pageInfo.hasNextPage;
        cursor = products.pageInfo.endCursor;
      }

      return json({
        status: "success",
        message: `${totalProducts} ürün başarıyla senkronize edildi.`
      });

    } catch (dbError) {
      console.error('Veritabanı işlem hatası:', dbError);
      throw new Error(`Veritabanı işlem hatası: ${dbError.message}`);
    }

  } catch (error) {
    console.error("Senkronizasyon hatası:", error);
    return json({
      status: "error",
      message: `Senkronizasyon hatası: ${error.message}`
    }, { status: 500 });
  }
};

export default function Index() {
  const [syncStatus, setSyncStatus] = useState(null);
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData();
  const { totalProducts, totalImages, metaRules, subscriptionStatus } = useLoaderData();
  const isLoading = navigation.state === "submitting";

  const handleSync = () => {
    setSyncStatus(null);
    submit({}, { method: "POST" });
  };

  const rows = metaRules.map(rule => [
    rule.name,
    rule.type,
    rule.pattern,
    rule.description || '-',
    rule.status || 'Beklemede',
    new Date(rule.createdAt).toLocaleDateString('tr-TR')
  ]);

  if (actionData && !syncStatus) {
    setSyncStatus(actionData);
  }

  return (
    <Page title="Ürün Senkronizasyonu">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <div style={{ marginBottom: "20px" }}>
              <p>
                Bu işlem mağazanızdaki tüm ürünleri veritabanına senkronize edecektir.
                İşlem, ürün sayınıza bağlı olarak biraz zaman alabilir.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Button
                primary
                onClick={handleSync}
                disabled={isLoading}
              >
                Ürünleri Senkronize Et
              </Button>
              {isLoading && <span>Senkronize ediliyor...</span>}
            </div>
          </LegacyCard>
        </Layout.Section>

        {syncStatus && (
          <Layout.Section>
            <Banner
              title={syncStatus.status === "success" ? "Başarılı!" : "Hata!"}
              status={syncStatus.status === "success" ? "success" : "critical"}
            >
              <p>{syncStatus.message}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 4, lg: 4, xl: 4 }}>
              <LegacyCard sectioned>
                <div style={{ textAlign: 'center' }}>
                  <Icon source={InventoryIcon} color="base" />
                  <Text variant="headingMd" as="h3">Toplam Ürün</Text>
                  <Text variant="heading2xl" as="p">{totalProducts}</Text>
                </div>
              </LegacyCard>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 4, lg: 4, xl: 4 }}>
              <LegacyCard sectioned>
                <div style={{ textAlign: 'center' }}>
                  <Icon source={ImagesIcon} color="base" />
                  <Text variant="headingMd" as="h3">Toplam Görsel</Text>
                  <Text variant="heading2xl" as="p">{totalImages}</Text>
                </div>
              </LegacyCard>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 4, lg: 4, xl: 4 }}>
              <LegacyCard sectioned>
                <div style={{ textAlign: 'center' }}>
                  <Icon source={StarFilledIcon} color="base" />
                  <Text variant="headingMd" as="h3">Üyelik Durumu</Text>
                  {subscriptionStatus.hasActivePayment ? (
                    <Text variant="heading2xl" as="p" color="success">Pro</Text>
                  ) : (
                    <>
                      <Text variant="bodyMd" as="p">
                        Daha fazla özellik için Pro üyeliğe geçin
                      </Text>
                      <div style={{ marginTop: '1rem' }}>
                        <Button primary url="/app/subscription">Pro'ya Yükselt</Button>
                      </div>
                    </>
                  )}
                </div>
              </LegacyCard>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        <Layout.Section>
          <LegacyCard title="Son Meta Kuralları">
            <DataTable
              columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
              headings={[
                'Kural Adı',
                'Tür',
                'Desen',
                'Açıklama',
                'Durum',
                'Oluşturma Tarihi'
              ]}
              rows={rows}
              footerContent={`Toplam ${rows.length} kayıt gösteriliyor`}
            />
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
