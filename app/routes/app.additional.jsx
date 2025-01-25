import { useState } from "react";
import {
  Box,
  Card,
  Layout,
  Link,
  List,
  Page,
  Text,
  BlockStack,
  LegacyCard,
  TextField,
  Button,
  DataTable
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { applyRuleToProducts } from "../utils/metaRules";

export default function AdditionalPage() {
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");

  const handleSubmit = async () => {
    const { admin, shop } = await authenticate.admin();
    
    const rule = await prisma.metaRule.create({
      data: {
        name,
        pattern,
        shopId: shop.id
      }
    });

    await applyRuleToProducts(shop, rule, admin);
  };

  return (
    <Page title="Meta Kuralları">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <TextField
              label="Kural Adı"
              value={name}
              onChange={setName}
            />
            <TextField
              label="Pattern"
              value={pattern}
              onChange={setPattern}
              helpText="Kullanılabilir değişkenler: {title}, {first_image_alt}"
            />
            <Button primary onClick={handleSubmit}>Kural Ekle ve Uygula</Button>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Code({ children }) {
  return (
    <Box
      as="span"
      padding="025"
      paddingInlineStart="100"
      paddingInlineEnd="100"
      background="bg-surface-active"
      borderWidth="025"
      borderColor="border"
      borderRadius="100"
    >
      <code>{children}</code>
    </Box>
  );
}
