# ZentarNetwork Discord Botu

`Minecraft Sunucularınız için Discord botu ve Minecraft (Paper/Spigot) köprü eklentisi.
**Web paneli yoktur.** Tüm yönetim Discord slash komutları, embed'ler, butonlar, select menüler ve modallarla yapılır.
Dışarıya açılan tek ağ bileşeni, bot ile Minecraft eklentisi arasındaki imzalı WebSocket köprüsüdür (varsayılan olarak yalnızca `127.0.0.1`).

## İçindekiler
1. [Gereksinimler](#gereksinimler)
2. [Discord botu oluşturma](#discord-botu-oluşturma)
3. [MongoDB](#mongodb)
4. [Kurulum (Windows)](#kurulum-windows)
5. [Slash komutlarını kaydetme](#slash-komutlarını-kaydetme)
6. [İlk yapılandırma (Discord içinden)](#ilk-yapılandırma-discord-içinden)
7. [Minecraft eklentisi](#minecraft-eklentisi)
8. [Köprü güvenliği](#köprü-güvenliği)
9. [Komut listesi](#komut-listesi)
10. [Testler](#testler)
11. [Bilinen sınırlar](#bilinen-sınırlar)

## Gereksinimler
- Node.js **20 veya üzeri** (LTS önerilir)
- MongoDB 6+ (yerel veya Atlas)
- Eklenti için: Paper (veya Spigot) 1.20.x, Java 17+ (1.21+ için Java 21) ve derlemek için Maven 3.8+ ile JDK 17+

## Discord botu oluşturma
1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** sekmesi → **Reset Token** ile token alın (yalnızca `.env` içine yazın, kimseyle paylaşmayın).
3. Aynı sekmede **Privileged Gateway Intents** altında şunları **açın**:
   - **Server Members Intent** (karşılama, otomatik rol, çekiliş koşulları)
   - **Message Content Intent** (sohbet köprüsü, XP)
4. **CLIENT_ID** = uygulamanın *Application ID* değeri. **GUILD_ID** = Discord'da Geliştirici Modu açıkken sunucuya sağ tık → *ID'yi kopyala*.
5. Botu davet edin (`CLIENT_ID` değerini değiştirin):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=1099914406934
   ```
   Bu bağlantı yalnızca gereken izinleri ister:

   | İzin | Neden |
   |---|---|
   | View Channels, Send Messages, Embed Links, Attach Files, Read Message History | Mesajlar, embed'ler, transcript dosyası |
   | Manage Channels | Bilet kanalları, kilitle/yavaş mod |
   | Manage Roles | Doğrulanmış/otomatik rol, rol menüsü |
   | Kick Members, Ban Members, Moderate Members | Moderasyon komutları |
   | Manage Messages | `/mesaj-sil` |
   | Manage Nicknames | `/nick` |

   Botun rolü, yönettiği rollerin (doğrulanmış rolü, rol menüsü rolleri vb.) ve moderasyon hedeflerinin **üstünde** olmalıdır.

> Bot tek sunucu içindir (`GUILD_ID`); başka sunucudaki etkileşimleri reddeder.

## MongoDB
- Yerel: MongoDB Community Server'ı kurup çalıştırın → `MONGODB_URI=mongodb://127.0.0.1:27017/zentarnetwork`
- Atlas: *Connect → Drivers* bağlantı dizesini kullanın (IP erişim listesine makinenizi ekleyin).

Koleksiyonlar ve indeksler (benzersiz katılım, benzersiz hesap bağlama, TTL'li doğrulama kodları vb.) ilk açılışta otomatik oluşturulur. Bağlantı kopmalarında sürücü kendiliğinden yeniden bağlanır; ilk bağlantıda 5 deneme yapılır.

## Kurulum (Windows)
1. `.env.example` dosyasını `.env` olarak kopyalayın ve doldurun:
   ```
   DISCORD_TOKEN, CLIENT_ID, GUILD_ID, MONGODB_URI, MC_BRIDGE_SECRET
   ```
   `MC_BRIDGE_SECRET` için: `node scripts\generate-secret.js` (en az 32 karakter).
   `.env` dosyası `.gitignore` içindedir; **gerçek anahtarları `.env.example` içine yazmayın.**
2. `install.bat` çalıştırın: Node sürümünü denetler, bağımlılıkları kurar, yapılandırma/MongoDB/token kontrollerini yapar ve slash komutlarını kaydeder.
3. `start.bat` ile botu başlatın. Hata olursa pencere kapanmaz, nedeni yazar. Yeni terminal penceresi açılmaz.

Elle: `npm install` → `npm run check` → `npm run deploy` → `npm start`.

## Slash komutlarını kaydetme
`npm run deploy` (veya `node scripts/deploy-commands.js`) komutları **yalnızca `GUILD_ID` sunucusuna** kaydeder (anında görünür). Komut eklediğinizde/değiştirdiğinizde yeniden çalıştırın.

## İlk yapılandırma (Discord içinden)
1. `/admin-panel` → (Yönetici veya Sunucuyu Yönet izni gerekir).
2. **Doğrulama ve rol yönetimi** bölümünden yönetici/moderatör/destek/doğrulanmış/otomatik rolleri seçin.
3. **Log kanalları** bölümünden kanalları seçin: durum mesajı, sohbet köprüsü, modlog, karşılama, sunucu olayları, çekiliş, bilet log/kategori, hata bildirimi vb. (Bot seçilen kanala yazabiliyor mu diye denetlenir.)
4. **Sohbet köprüsü** bölümünden köprüyü açın.
5. **Bot yapılandırması** bölümünden bildirimleri, XP sınırlarını ve karşılama/ayrılma metinlerini düzenleyin.
6. Bir kanalda `/destek-panel` ile destek panelini yayınlayın.

Her etkileşimde (buton, menü, modal) yetki yeniden doğrulanır. Bileşenler durumsuzdur (`zn:modül:eylem` kimlikleri), bot yeniden başlasa da çalışır; geçersiz/eski bir bileşene basılırsa kullanıcıya uyarı gösterilir. Panel kapanırsa `/admin-panel` ile yeniden açılır.

## Minecraft eklentisi
Kaynak: [`minecraft-plugin/`](minecraft-plugin). Harici bağımlılığı yoktur (Gson sunucuda hazır gelir; WebSocket için JDK'nın `java.net.http` sınıfları kullanılır).

**Derleme**
```bash
cd minecraft-plugin
mvn clean package
```
Çıktı: `minecraft-plugin/target/ZentarBridge-1.0.0.jar`. Sunucu sürümünüz farklıysa `pom.xml` içindeki `paper.version` ve `plugin.yml` içindeki `api-version` değerlerini güncelleyin.

**Kurulum**
1. Jar'ı sunucunun `plugins/` klasörüne koyup sunucuyu bir kez başlatın.
2. `plugins/ZentarBridge/config.yml` içinde:
   - `bridge.url` → botun adresi (`ws://127.0.0.1:8765`; farklı makinedeyse bkz. [Köprü güvenliği](#köprü-güvenliği))
   - `bridge.secret` → `.env` içindeki `MC_BRIDGE_SECRET` ile aynı değer (alternatif: `ZENTAR_BRIDGE_SECRET` ortam değişkeni)
   - `chat.rank-placeholder` → PlaceholderAPI yüklüyse rütbe yer tutucusu (ör. `%luckperms_prefix%`)
3. `/zentarbridge reload` ile yenileyin; `/zentarbridge status` bağlantıyı gösterir.

**Eklenti özellikleri**
- Minecraft → Discord: sohbet (`[GenPvP] [Rütbe] Oyuncu: mesaj`), katılma, ayrılma, ölüm, doğrulama.
- Discord → Minecraft: `[Discord] Kullanıcı: mesaj` — yalnızca sohbet satırı olarak yayınlanır, **hiçbir zaman komut olarak çalıştırılmaz**.
- `/dogrula <kod>` (oyun içi hesap doğrulama), bakım modu (yetkisiz oyuncuları engeller; `zentarbridge.maintenance.bypass` izni olanlar girebilir), duyuru/yetkili mesajı, oyuncu bilgisi, durum raporu.
- Bot kapalıyken eklenti çalışmaya devam eder; 1 sn'den başlayıp 30 sn'ye çıkan gecikmeyle otomatik yeniden bağlanır. Bot yeniden bağlanınca bakım durumu MongoDB'deki kayıttan oyuna senkronlanır.

## Köprü güvenliği
- Her mesaj `{p, s}` zarfıdır; `s` = `HMAC-SHA256(secret, p)`. İmza, içerik ayrıştırılmadan önce sabit zamanlı karşılaştırmayla doğrulanır.
- `p` içinde benzersiz `id`, `ts` (±60 sn pencere) ve yön (`from: bot|plugin`) vardır: tekrar (replay), eski mesaj ve yansıtma saldırıları reddedilir.
- Bağlantı ilk imzalı `hello` ile 5 sn içinde doğrulanmazsa kapatılır; imzasız/yanlış imzalı mesaj bağlantıyı düşürür. Bağlantı başına hız sınırı (10 sn'de 60 mesaj) ve 64 KB boyut sınırı vardır.
- Anahtar kodda sabit değildir (`.env` / `config.yml`/ortam değişkeni).
- Köprü varsayılan olarak `127.0.0.1`'e bağlanır. **HMAC bütünlük ve kimlik doğrulama sağlar, gizlilik sağlamaz** (düz `ws://`). Bot ve sunucu farklı makinelerdeyse köprüyü TLS arkasına (reverse proxy ile `wss://`) alın veya VPN/güvenlik duvarı ile yalnızca sunucu IP'sine açın.
- Saatler arasındaki fark 60 sn'yi geçmemeli (Windows saat senkronizasyonu / NTP açık olsun).

## Komut listesi
| Alan | Komutlar |
|---|---|
| Yönetim | `/admin-panel` |
| Minecraft | `/sunucu` `/durum` `/ping` `/oyuncular` `/oyuncu` `/istatistik` `/sunucuyenile` `/bakim aç\|kapat` `/duyuru` `/sunucumesaj` |
| Çekiliş | `/çekiliş oluştur\|bitir\|yeniden-çek\|iptal\|katılımcılar\|bilgi\|liste\|uzat` |
| Moderasyon | `/uyar` `/uyarılar` `/uyarı-sil` `/timeout` `/timeout-kaldır` `/at` `/yasakla` `/yasak-kaldır` `/mesaj-sil` `/yavaş-mod` `/kilitle` `/kilit-aç` `/nick` `/modlog` |
| Bilet | `/destek-panel` `/bilet ekle\|çıkar\|limit` (+ panel butonları: Kapat, Devral) |
| Doğrulama | `/doğrula` `/doğrulama-kaldır` |
| Topluluk | `/profil` `/liderlik` `/günlük` `/anket` `/rolmenü` `/kurallar` `/etkinlik` `/otoduyuru ekle\|liste\|sil` |

Notlar:
- Minecraft tarafında karşılığı olan işlemler (`/duyuru`, `/sunucumesaj`, `/bakim`, oyuncu bilgisi) eklenti **onay vermezse başarılı gösterilmez**; eklenti bağlı değilse bunu açıkça söyler. Bakım ayarı bu durumda kaydedilir ve eklenti bağlandığında uygulanır.
- `/sunucu`, durum kanalı mesajı ve `/durum` gerçek sunucu sorgusundan (Server List Ping) beslenir; sunucuya ulaşılamıyorsa eski oyuncu sayıları gösterilmez. Oyuncu listesi eklenti bağlıysa tamdır; değilse yalnızca sunucunun örneklediği isimler gösterilir ve bu belirtilir.
- `/çekiliş oluştur` bitişi `süre` (`1h30m`, `2d`) veya `bitiş` (`2026-12-31 20:30`, Türkiye saati) ile alır.
- XP: mesaj başına rastgele min–max XP, bekleme süresi veritabanında atomik uygulanır; çok kısa ve aynı metnin tekrarı sayılmaz. Tüm sınırlar panelden ayarlanır.

## Testler
```bash
npm test
```
41 otomatik test: imza/replay/zaman aşımı, gerçek WebSocket köprüsü (kimlik doğrulama, yeniden bağlanma, istek/yanıt), çekiliş mantığı, ve geçici bir MongoDB üzerinde (mongodb-memory-server) çekiliş/doğrulama/bilet/XP/sohbet köprüsü senaryoları. Ayrıntılar ve **test edilemeyenler** için aşağıya bakın.

## Bilinen sınırlar
Bu ortamda yapılamayan/yapılmayan doğrulamalar:
- **Gerçek Discord bağlantısı** denenmedi (ortamda Discord'a erişim ve token yoktu). Slash komut tanımları yerelde `toJSON()` ile üretildi ve yüklendi; Discord'un kabul etmesi `install.bat`/`npm run deploy` ile ilk çalıştırmada görülür.
- **Java eklentisi derlenmedi ve bir Paper sunucuda çalıştırılmadı** (ortamda yalnızca Java 8 JRE vardı, JDK/Maven yok). İmza protokolünün karşı tarafı (bot) gerçek WebSocket testleriyle sınandı; Java tarafı aynı protokolü uygular ama ilk derlemede küçük düzeltmeler gerekebilir.
- Butonlar/menüler/modallar (admin paneli dahil) ve moderasyon komutları gerçek Discord üzerinde denenmedi; yalnızca modül yükleme, builder doğrulaması ve iş mantığı testleri yapıldı.
- Çok kısa tekrar bildirimleri: oyuncu katılma/ayrılma, köprü kanalı açıksa oraya, değilse bildirim kanalına gider.
