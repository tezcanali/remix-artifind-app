import { json, redirect } from "@remix-run/node";
import { Page, Layout, LegacyCard, Button, Text, Banner } from "@shopify/polaris";
import { authenticate, MONTHLY_PLAN, ANNUAL_PLAN } from "../shopify.server";
import { useSubmit, useActionData, useLoaderData } from "@remix-run/react";

export const loader = async ({ request }) => {
  const { billing } = await authenticate.admin(request);

  // Mevcut abonelik durumunu kontrol et
  const subscriptionStatus = await billing.check({
    plans: [MONTHLY_PLAN, ANNUAL_PLAN],
    isTest: true,
  });

  return json({ subscriptionStatus });
};

export const action = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planType = formData.get('planType');
  const selectedPlan = planType === 'monthly' ? MONTHLY_PLAN : ANNUAL_PLAN;

  // Shop adını ayarla
  let { shop } = session;
  let myShop = shop.replace(".myshopify.com", "");

  const response = await billing.request({
    plan: selectedPlan,
    isTest: true,
    returnUrl: `https://admin.shopify.com/store/${myShop}/apps/${process.env.APP_NAME}/app/subscription`,
  });

  return redirect(response.confirmationUrl);
};

export default function Subscription() {
  const submit = useSubmit();
  const actionData = useActionData();
  const { subscriptionStatus } = useLoaderData();

  return (
    <Page title="Abonelik Planları">
      <Layout>
        {actionData?.status === "error" && (
          <Layout.Section>
            <Banner status="critical">
              {actionData.message}
            </Banner>
          </Layout.Section>
        )}

        {subscriptionStatus && (
          <Layout.Section>
            <Banner status="info">
              <p>Mevcut abonelik durumu: {JSON.stringify(subscriptionStatus)}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <LegacyCard sectioned>
            <Text variant="headingMd" as="h2">Aylık Plan</Text>
            <div style={{ marginTop: "1rem" }}>
              <Text>
                • Tüm özelliklere erişim<br />
                • 14 gün ücretsiz deneme<br />
                • Aylık $5.99
              </Text>
              <div style={{ marginTop: "1rem" }}>
                <Button
                  primary
                  onClick={() => {
                    const formData = new FormData();
                    formData.append('planType', 'monthly');
                    submit(formData, { method: 'post' });
                  }}
                >
                  Aylık Plan'a Abone Ol
                </Button>
              </div>
            </div>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section>
          <LegacyCard sectioned>
            <Text variant="headingMd" as="h2">Yıllık Plan</Text>
            <div style={{ marginTop: "1rem" }}>
              <Text>
                • Tüm özelliklere erişim<br />
                • 14 gün ücretsiz deneme<br />
                • Yıllık $50 (2 ay bedava)
              </Text>
              <div style={{ marginTop: "1rem" }}>
                <Button
                  primary
                  onClick={() => {
                    const formData = new FormData();
                    formData.append('planType', 'annual');
                    submit(formData, { method: 'post' });
                  }}
                >
                  Yıllık Plan'a Abone Ol
                </Button>
              </div>
            </div>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
} 