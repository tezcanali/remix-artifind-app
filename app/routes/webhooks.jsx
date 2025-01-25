import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  console.log("Webhook alındı:", topic, shop);
  console.log("Payload:", payload); // Debug için payload'ı loglayalım

  try {
    switch (topic) {
      case "APP_UNINSTALLED":
        await prisma.shop.update({
          where: { shopDomain: shop },
          data: { isActive: false }
        });
        break;

      case "PRODUCTS_CREATE":
      case "PRODUCTS_UPDATE":
        const product = payload;
        const shopData = await prisma.shop.findUnique({
          where: { shopDomain: shop }
        });

        await prisma.product.upsert({
          where: {
            shopId_shopifyId: {
              shopId: shopData.id,
              shopifyId: product.id.toString()
            }
          },
          create: {
            shopifyId: product.id.toString(),
            title: product.title,
            metaTitle: product.metafields?.find(m => m.key === 'title')?.value,
            shopId: shopData.id,
            images: {
              create: product.images.map(image => ({
                shopifyId: image.id.toString(),
                src: image.src,
                alt: image.alt
              }))
            }
          },
          update: {
            title: product.title,
            metaTitle: product.metafields?.find(m => m.key === 'title')?.value,
            images: {
              deleteMany: {},
              create: product.images.map(image => ({
                shopifyId: image.id.toString(),
                src: image.src,
                alt: image.alt
              }))
            }
          }
        });
        break;
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Webhook işleme hatası:", error);
    console.error("Hata detayı:", error.message);
    console.error("Payload:", payload); // Hata durumunda payload'ı da loglayalım
    return new Response(null, { status: 500 });
  }
}; 