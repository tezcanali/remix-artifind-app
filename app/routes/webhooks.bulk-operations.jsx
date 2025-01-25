import prisma from "../db.server";

export const action = async ({ request }) => {
  try {
    const payload = await request.json();
    console.log('Webhook payload:', payload);

    // Bulk operation ID'sine sahip meta rule'u bul ve güncelle
    const metaRule = await prisma.metaRule.findFirst({
      where: {
        bulkOperationId: payload.admin_graphql_api_id,
        status: 'RUNNING'
      },
      include: {
        shop: true // Shop bilgisini de al
      }
    });

    if (!metaRule) {
      console.log('No matching meta rule found for bulk operation:', payload.admin_graphql_api_id);
      return new Response();
    }

    // Rule'u güncelle
    await prisma.metaRule.update({
      where: { id: metaRule.id },
      data: {
        status: payload.status === 'completed' ? 'COMPLETED' : 'FAILED',
        isApplied: payload.status === 'completed',
        updatedAt: new Date(payload.completed_at || payload.created_at)
      }
    });

    // Webhook log'u kaydet
    await prisma.webhookLog.create({
      data: {
        topic: 'bulk_operations/finish',
        payload: JSON.stringify(payload),
        processedAt: new Date(),
        success: true,
        shopId: metaRule.shopId // Shop ID'yi ekle
      }
    });

    return new Response();
  } catch (error) {
    console.error('Webhook error:', error);
    
    // Hata durumunda da log tut
    await prisma.webhookLog.create({
      data: {
        topic: 'bulk_operations/finish',
        payload: JSON.stringify({ error: error.message }),
        processedAt: new Date(),
        success: false,
        error: error.message,
        shopId: metaRule?.shopId || 0 // Eğer metaRule bulunduysa onun shop ID'si, bulunamadıysa 0
      }
    });

    return new Response('Error', { status: 500 });
  }
};