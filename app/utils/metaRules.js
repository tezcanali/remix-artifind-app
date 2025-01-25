export const applyMetaRule = (product, rule) => {
  let metaTitle = rule.pattern;

  metaTitle = metaTitle
    .replace('{title}', product.title)
    .replace('{first_image_alt}', product.images[0]?.alt || '');

  return metaTitle;
};

export const applyRuleToProducts = async (shop, rule, admin) => {
  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    include: { images: true }
  });

  for (const product of products) {
    const newMetaTitle = applyMetaRule(product, rule);
    
    await admin.graphql(`
      mutation updateProductMetafields($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
          }
        }
      }
    `, {
      variables: {
        input: {
          id: product.shopifyId,
          metafields: [
            {
              namespace: "global",
              key: "title",
              value: newMetaTitle,
              type: "single_line_text_field"
            }
          ]
        }
      }
    });

    await prisma.product.update({
      where: { id: product.id },
      data: { metaTitle: newMetaTitle }
    });
  }
};

export async function updateProductMetafields(admin, productId, metaTitle) {
  const UPDATE_METAFIELD = `
    mutation updateProductMetafields($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  await admin.graphql(UPDATE_METAFIELD, {
    variables: {
      input: {
        id: productId,
        metafields: [
          {
            namespace: "global",
            key: "title_tag",
            value: metaTitle,
            type: "single_line_text_field"
          }
        ]
      }
    }
  });
} 