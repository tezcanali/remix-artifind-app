Shopify Toplu Meta Title Düzenleme Uygulaması

Proje Kapsamında;

- Ürün, Koleksiyon ve Blog Post'larının meta title'larının düzenlenmesi,
- Kullanıcı bir kural belirlediğinde, bu kurala göre meta title'larının toplu olarak oluşturulması ve düzenlenmesi,

Altyapı olarak Shopify CLI kullanılacak. Mevcutta Laravel ile yapılan App artık Shopify CLI ile yapılacak.

Laravelde ki mevcut veritabanı yapısı:
- Shop,
- Products
- Images
- Meta Tags

Süreç akışını aktarıyorum bunu birebir aynı olmak zorunda değil, gerekirse akışı optimize edebilirsin.
1. Kullanıcı shopify mağazasına uygulamayı kurduğunda App Install webhook ile Product ve Image verileri alınıyor ve veritabanına kaydediliyor.
2. Kullanıcı kural belirlediğinde veritabanına kural kaydediliyor.
3. Kullanıcı kuralı çalıştırdığında veritabanındaki Product ve Image verilerine kural uygulanıyor ve tekrardan shopify'e gönderiliyor.

Ayrıca uygulamada subscription işlemleri de olacak. App üzerinden subscription alınıyor.


# artifind-app
