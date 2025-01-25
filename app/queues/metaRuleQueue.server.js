import Queue from 'bull';
import prisma from '../db.server';
import { authenticate } from '../shopify.server';

// Redis URL'i environment'tan al veya varsayılan kullan
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const metaRuleQueue = new Queue('meta-rule-processing', REDIS_URL, {
  limiter: {
    max: 1, // Aynı anda sadece 1 iş işlensin
    duration: 1000 // Her 1 saniyede
  }
});

const STAGED_UPLOAD_MUTATION = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const BULK_MUTATION = `#graphql
  mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(
      mutation: $mutation,
      stagedUploadPath: $stagedUploadPath
    ) {
      bulkOperation {
        id
        url
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const BULK_OPERATION_STATUS = `#graphql
  query getBulkOperation($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  }
`;

class MetaRuleProcessor {
  async process(ruleId, admin) {
    try {
      const rule = await prisma.metaRule.findUnique({
        where: { id: ruleId },
        include: { shop: true }
      });

      if (!rule) {
        throw new Error('Kural bulunamadı');
      }

      // Tüm ürünleri ve resimlerini getir
      const products = await prisma.product.findMany({
        where: { shopId: rule.shopId },
        include: {
          images: true
        }
      });

      if (rule.type === 'product') {
        // Ürün meta bilgilerini güncelle
        const mutationLines = products.map(product => {
          const metaTitle = rule.pattern
            .replace('{product_title}', product.title)
            .replace('{shop_name}', rule.shop.name);
          
          const metaDescription = rule.description ? 
            rule.description
              .replace('{product_title}', product.title)
              .replace('{shop_name}', rule.shop.name) : 
            null;

          return JSON.stringify({
            input: {
              id: `gid://shopify/Product/${product.shopifyId}`,
              seo: {
                title: metaTitle,
                description: metaDescription
              }
            }
          });
        }).join('\n');

        // Stage upload için request
        const stageResponse = await admin.graphql(STAGED_UPLOAD_MUTATION, {
          variables: {
            input: [{
              resource: "BULK_MUTATION_VARIABLES",
              filename: "mutations.jsonl",
              mimeType: "application/jsonl",
              httpMethod: "POST"
            }]
          }
        });

        const stageData = await stageResponse.json();
        const { url, parameters } = stageData.data.stagedUploadsCreate.stagedTargets[0];

        // Form data hazırla
        const formData = new FormData();
        parameters.forEach(param => {
          formData.append(param.name, param.value);
        });

        // JSONL dosyasını ekle
        formData.append('file', new Blob([mutationLines], { type: 'application/jsonl' }));

        // Dosyayı yükle
        const uploadResponse = await fetch(url, {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) {
          throw new Error('Dosya yükleme başarısız');
        }

        // Bulk operation'ı başlat
        const bulkResponse = await admin.graphql(BULK_MUTATION, {
          variables: {
            mutation: `
              mutation productUpdate($input: ProductInput!) {
                productUpdate(input: $input) {
                  product {
                    id
                  }
                }
              }
            `,
            stagedUploadPath: parameters.find(p => p.name === 'key').value
          }
        });

        const bulkData = await bulkResponse.json();
        const operationId = bulkData.data.bulkOperationRunMutation.bulkOperation.id;

        await prisma.metaRule.update({
          where: { id: ruleId },
          data: {
            bulkOperationId: operationId,
            status: 'RUNNING'
          }
        });

      } else if (rule.type === 'image') {
        // Tüm ürünleri ve resimlerini getir
        const products = await prisma.product.findMany({
          where: { shopId: rule.shopId },
          include: { images: true }
        });

        // Her ürün ve resim için JSONL formatında mutation satırları oluştur
        const mutationLines = products.flatMap(product => 
          product.images.map((image, index) => {
            const alt = rule.pattern
              .replace('{product_title}', product.title)
              .replace('{shop_name}', rule.shop.name)
              .replace('{image_position}', (index + 1).toString());

            return JSON.stringify({
              productId: `gid://shopify/Product/${product.shopifyId}`,
              media: [{
                id: `gid://shopify/MediaImage/${image.shopifyId}`,
                alt: alt
              }]
            });
          })
        ).join('\n');

        // Stage upload için request
        const stageResponse = await admin.graphql(STAGED_UPLOAD_MUTATION, {
          variables: {
            input: [{
              resource: "BULK_MUTATION_VARIABLES",
              filename: "mutations.jsonl",
              mimeType: "application/jsonl",
              httpMethod: "POST"
            }]
          }
        });

        const stageData = await stageResponse.json();
        const { url, parameters } = stageData.data.stagedUploadsCreate.stagedTargets[0];

        // Form data hazırla
        const formData = new FormData();
        parameters.forEach(param => {
          formData.append(param.name, param.value);
        });

        // JSONL dosyasını ekle
        formData.append('file', new Blob([mutationLines], { type: 'application/jsonl' }));

        // Dosyayı yükle
        const uploadResponse = await fetch(url, {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) {
          throw new Error('Dosya yükleme başarısız');
        }

        // Bulk operation'ı başlat
        const bulkResponse = await admin.graphql(BULK_MUTATION, {
          variables: {
            mutation: `
              mutation productUpdateMedia($media: [UpdateMediaInput!]!, $productId: ID!) {
                productUpdateMedia(media: $media, productId: $productId) {
                  media {
                    id
                    alt
                  }
                  mediaUserErrors {
                    field
                    message
                  }
                }
              }
            `,
            stagedUploadPath: parameters.find(p => p.name === 'key').value
          }
        });

        const bulkData = await bulkResponse.json();
        
        // Hata kontrolü
        if (bulkData.data?.bulkOperationRunMutation?.userErrors?.length > 0) {
          console.error('Bulk operation errors:', bulkData.data.bulkOperationRunMutation.userErrors);
          throw new Error(bulkData.data.bulkOperationRunMutation.userErrors[0].message);
        }

        const operationId = bulkData.data.bulkOperationRunMutation.bulkOperation.id;

        // Veritabanında güncelle
        for (const product of products) {
          for (const image of product.images) {
            const alt = rule.pattern
              .replace('{product_title}', product.title)
              .replace('{shop_name}', rule.shop.name)
              .replace('{image_position}', (product.images.indexOf(image) + 1).toString());

            await prisma.image.update({
              where: { id: image.id },
              data: { alt }
            });
          }
        }

        // Meta kuralının durumunu güncelle
        await prisma.metaRule.update({
          where: { id: ruleId },
          data: {
            bulkOperationId: operationId,
            status: 'RUNNING'
          }
        });
      }

      return { success: true };

    } catch (error) {
      console.error('Bulk operation error:', error);
      throw error;
    }
  }
}

export const metaRuleProcessor = new MetaRuleProcessor();

// Queue işleyicisi
metaRuleQueue.process(async (job) => {
  const { ruleId, session } = job.data;
  
  try {
    // İşlem başladığında progress'i güncelle
    job.progress(0);

    // Kuralı ve shop bilgisini al
    const rule = await prisma.metaRule.findUnique({
      where: { id: ruleId },
      include: { shop: true }
    });

    if (!rule) {
      throw new Error('Kural bulunamadı');
    }

    const admin = await authenticate.admin(session);

    if (rule.type === 'product') {
      // Tüm ürünleri getir
      const products = await prisma.product.findMany({
        where: { shopId: rule.shopId }
      });

      // Ürünleri 100'erli gruplar halinde işle
      const chunkSize = 100;
      for (let i = 0; i < products.length; i += chunkSize) {
        const chunk = products.slice(i, i + chunkSize);
        
        // Progress'i güncelle
        job.progress(Math.floor((i / products.length) * 100));
        
        // Her ürün için SEO güncellemesi yap
        for (const product of chunk) {
          const metaTitle = rule.pattern
            .replace('{product_title}', product.title)
            .replace('{shop_name}', rule.shop.name);
          
          const metaDescription = rule.description ? 
            rule.description
              .replace('{product_title}', product.title)
              .replace('{shop_name}', rule.shop.name) : 
            null;

          // Shopify'da güncelle
          await admin.graphql(`#graphql
            mutation updateProductSEO($input: ProductInput!) {
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
          `, {
            variables: {
              input: {
                id: `gid://shopify/Product/${product.shopifyId}`,
                seo: {
                  title: metaTitle,
                  description: metaDescription
                }
              }
            }
          });

          // Veritabanında güncelle
          await prisma.product.update({
            where: { id: product.id },
            data: {
              metaTitle,
              metaDescription
            }
          });
        }

        // Rate limiting için bekle
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } else if (rule.type === 'image') {
      // Benzer bulk işlem resimler için
      // ... resim işleme kodu ...
    }

    // Kuralı tamamlandı olarak işaretle
    await prisma.metaRule.update({
      where: { id: ruleId },
      data: { isApplied: true }
    });

    // İşlem tamamlandı
    job.progress(100);
    
    return { success: true };
  } catch (error) {
    console.error('Queue processing error:', error);
    throw error;
  }
});

// Hata durumunda
metaRuleQueue.on('failed', (job, err) => {
  console.error('Job failed:', job.id, err);
});

// İş tamamlandığında
metaRuleQueue.on('completed', (job) => {
  console.log('Job completed:', job.id);
});

export default metaRuleQueue; 