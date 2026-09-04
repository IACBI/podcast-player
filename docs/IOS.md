# iOS kabuğu (Capacitor) — uygulanmamış prosedür

> **Bu dosyadaki hiçbir adım çalıştırılmadı.** Capacitor bağımlılıkları repoya
> eklenmedi ve `ios/` dizini üretilmedi: her ikisi de macOS + Xcode + Apple
> Developer hesabı olmadan doğrulanamaz, doğrulanmamış bir `ios/` ağacını
> commit'lemek de yanıltıcı olur. Aşağıdakiler bir Mac'te sırayla uygulanacak
> adımlardır — `docs/STORE.md` §5'in devamı.

Amaç tek bir şey: iOS'ta ekran kilitliyken sesin devam etmesi. Safari PWA'da
WebKit arka plandaki sayfayı askıya alabiliyor; `UIBackgroundModes: audio` +
`AVAudioSession(.playback)` bunu ortadan kaldıran tek mekanizma.

## 1) Bağımlılıklar

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/ios
npx cap init Seseri io.github.iacbi.seseri --web-dir dist
```

## 2) `capacitor.config.ts` (repo kökü)

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.iacbi.seseri',
  appName: 'Seseri',
  // Paketlenmiş varlıklar. `server.url` ile canlı siteye bağlamak cazip ama
  // uygulamayı çevrimdışı kullanılamaz hale getirir ve App Review'un
  // "sadece web sitesi sarmalayıcı" reddine doğrudan davetiye çıkarır.
  webDir: 'dist',
  ios: {
    // <audio> tam ekran oynatıcıya kaçmasın; arka plan sesi buna bağlı.
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
```

`npm run build` sonrası `npx cap sync ios`.

## 3) `ios/App/App/Info.plist`

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

Bu anahtar olmadan diğer her şey işe yaramaz: iOS uygulamayı arka plana
düştüğü anda askıya alır.

## 4) `ios/App/App/AppDelegate.swift`

`application(_:didFinishLaunchingWithOptions:)` içine:

```swift
import AVFoundation

// .playback: sessize alma anahtarına ve ekran kilidine rağmen çalar.
// .spokenAudio: konuşma içeriği için doğru mod — araç sistemleri ve AirPods
// bunu müzikten farklı ele alır (ör. navigasyon anonsunda durdurup devam eder).
try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
try? AVAudioSession.sharedInstance().setActive(true)
```

## 5) İstemci tarafında yapılmayacak olan

**Ses motorunu değiştirme.** `WKWebView` + `AVAudioSession(.playback)` altında
mevcut `<audio>` elementi zaten arka planda çalar. `Capacitor.isNativePlatform()`
ile ikinci bir yerel ses motoruna geçmek (`@capacitor-community/native-audio` vb.)
hız kontrolü, waveform, uyku zamanlayıcı ve Media Session entegrasyonunun
tamamını kırar — hepsi tek bir element etrafında kurulu (`src/player/engine.ts`).
Tek motor korunur.

## 6) Gerekli hesap/sertifika

1. Apple Developer Program üyeliği ($99/yıl).
2. Xcode'da signing team + bundle id kaydı.
3. App Store Connect kaydı, gizlilik formu (veri toplanmıyor).
4. `docs/STORE.md` §5'teki ToS notu iOS için de geçerlidir.

## 7) Android uyarısı

Android'i Capacitor'a **taşıma.** Mevcut TWA, Chrome'un medya ön plan
servisini bedava alıyor; Capacitor'ın `WebView`'i almaz ve yerel bir
`MediaSessionService` plugin'i yazmadan arka plan sesi gerileyerek çıkar.
Detay: `docs/STORE.md` §4.
