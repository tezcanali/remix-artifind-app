import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { restResources } from "@shopify/shopify-api/rest/admin/2024-01";
import { LATEST_API_VERSION } from "@shopify/shopify-api";

export const MONTHLY_PLAN = 'Monthly subscription';
export const ANNUAL_PLAN = 'Annual subscription';

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October24,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  webhooks: {
    path: "/webhooks",
    handlers: {
      APP_INSTALLED: {
        deliveryMethod: "http",
        callbackUrl: "/webhooks",
        callback: async (topic, shop, body, webhookId) => {
          console.log("App installed webhook received", { shop, webhookId });
          // Burada ürünleri ve görselleri senkronize edebilirsiniz
        },
      },
      APP_UNINSTALLED: {
        deliveryMethod: "http",
        callbackUrl: "/webhooks",
        callback: async (topic, shop, body, webhookId) => {
          console.log("App uninstalled webhook received", { shop, webhookId });
          // Burada gerekli temizlik işlemlerini yapabilirsiniz
        },
      },
      PRODUCTS_CREATE: {
        deliveryMethod: "http",
        callbackUrl: "/webhooks",
        callback: async (topic, shop, body, webhookId) => {
          console.log("Product created webhook received", { shop, webhookId });
          // Yeni ürün eklendiğinde yapılacak işlemler
        },
      },
      PRODUCTS_UPDATE: {
        deliveryMethod: "http",
        callbackUrl: "/webhooks",
        callback: async (topic, shop, body, webhookId) => {
          console.log("Product updated webhook received", { shop, webhookId });
          // Ürün güncellendiğinde yapılacak işlemler
        },
      },
    },
    afterAuth: async (req, res, session) => {
      const admin = new shopify.api.clients.Graphql({ session });
      
      try {
        // Tüm ürünleri çek
        const { data } = await admin.query({
          data: `{
            products(first: 250) {
              edges {
                node {
                  id
                  title
                  description
                  vendor
                  handle
                  status
                  priceRangeV2 {
                    minVariantPrice {
                      amount
                    }
                  }
                  images(first: 10) {
                    edges {
                      node {
                        id
                        src
                        altText
                      }
                    }
                  }
                }
              }
            }
          }`
        });

        // Her ürün için veritabanına kayıt
        for (const { node: product } of data.products.edges) {
          const shopifyId = product.id.replace('gid://shopify/Product/', '');
          
          // Ürünü kaydet
          const savedProduct = await prisma.product.create({
            data: {
              shopifyId: shopifyId,
              title: product.title,
              description: product.description || '',
              vendor: product.vendor || '',
              price: parseFloat(product.priceRangeV2?.minVariantPrice?.amount || 0),
              handle: product.handle,
              status: product.status,
              shop: session.shop, // Mağaza adını session'dan alıyoruz
            },
          });

          // Ürün görsellerini kaydet
          for (const { node: image } of product.images.edges) {
            const imageShopifyId = image.id.replace('gid://shopify/ProductImage/', '');
            await prisma.image.create({
              data: {
                type: 'product',
                shopifyId: imageShopifyId,
                src: image.src,
                altTitle: image.altText || '',
                shop: session.shop, // Mağaza adını session'dan alıyoruz
                productId: savedProduct.id,
              },
            });
          }
        }

        console.log('Ürünler başarıyla senkronize edildi');
      } catch (error) {
        console.error('Ürün senkronizasyonu hatası:', error);
      }
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  restResources,
  apiVersion: LATEST_API_VERSION,
  afterAuth: async ({ session, admin }) => {
    // Shop'u veritabanına kaydet veya güncelle
    const shop = await prisma.shop.upsert({
      where: { shopDomain: session.shop },
      create: {
        shopDomain: session.shop,
        accessToken: session.accessToken,
        isActive: true
      },
      update: {
        accessToken: session.accessToken,
        isActive: true
      }
    });

    // Tüm ürünleri çek
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = `
        query getProducts($cursor: String) {
          products(first: 50, after: $cursor) {
            edges {
              node {
                id
                title
                images(first: 10) {
                  edges {
                    node {
                      id
                      src
                      altText
                    }
                  }
                }
                metafields(first: 10) {
                  edges {
                    node {
                      key
                      value
                      namespace
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
      `;

      const response = await admin.graphql(query, {
        variables: { cursor }
      });

      const { products } = response.data;

      // Her ürünü veritabanına kaydet
      for (const { node: product } of products.edges) {
        const metaTitleField = product.metafields.edges.find(
          edge => edge.node.key === 'title' && edge.node.namespace === 'global'
        );

        await prisma.product.upsert({
          where: {
            shopId_shopifyId: {
              shopId: shop.id,
              shopifyId: product.id
            }
          },
          create: {
            shopId: shop.id,
            shopifyId: product.id,
            title: product.title,
            metaTitle: metaTitleField?.node.value,
            images: {
              create: product.images.edges.map(({ node: image }) => ({
                shopifyId: image.id,
                src: image.src,
                alt: image.altText
              }))
            }
          },
          update: {
            title: product.title,
            metaTitle: metaTitleField?.node.value,
            images: {
              deleteMany: {},
              create: product.images.edges.map(({ node: image }) => ({
                shopifyId: image.id,
                src: image.src,
                alt: image.altText
              }))
            }
          }
        });
      }

      hasNextPage = products.pageInfo.hasNextPage;
      cursor = products.pageInfo.endCursor;
    }

    // Webhook'ları kaydet
    const response = await admin.graphql(`
      mutation webhookSubscriptionCreate {
        webhookSubscriptionCreate(
          topic: PRODUCTS_CREATE
          webhookSubscription: {
            format: JSON,
            callbackUrl: "${process.env.HOST}/webhooks"
          }
        ) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
          }
        }
      }
    `);

    // Ürün güncelleme webhook'u
    await admin.graphql(`
      mutation webhookSubscriptionCreate {
        webhookSubscriptionCreate(
          topic: PRODUCTS_UPDATE
          webhookSubscription: {
            format: JSON,
            callbackUrl: "${process.env.HOST}/webhooks"
          }
        ) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
          }
        }
      }
    `);

    // App kaldırma webhook'u
    await admin.graphql(`
      mutation webhookSubscriptionCreate {
        webhookSubscriptionCreate(
          topic: APP_UNINSTALLED
          webhookSubscription: {
            format: JSON,
            callbackUrl: "${process.env.HOST}/webhooks"
          }
        ) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
          }
        }
      }
    `);
  },
  billing: {
    [MONTHLY_PLAN]: {
      lineItems: [
        {
          amount: 5.99,
          currencyCode: 'USD',
          interval: BillingInterval.Every30Days,
        }
      ],
    },
    [ANNUAL_PLAN]: {
      lineItems: [
        {
          amount: 59.99,
          currencyCode: 'USD',
          interval: BillingInterval.Annual,
        }
      ],
    }
  }
});

export default shopify;
export const apiVersion = ApiVersion.October24;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
