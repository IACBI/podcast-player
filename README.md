# 🎧 Podcast Player

Ücretsiz, üyeliksiz, tarayıcı tabanlı podcast dinleyici.
iTunes Search API kullanır — hiçbir arka uç veya hesap gerekmez.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://your-username.github.io/podcast-player/)

---

## Özellikler

- **Podcast Arama** — isim veya Apple Podcasts linki ile arama
- **Tam Oynatıcı** — play/pause, önceki/sonraki, ileri/geri atlama, hız kontrolü (0.5×–2.5×)
- **Kaldığın Yerden Devam** — bölüm ilerlemesi `localStorage`'a kaydedilir
- **Bölüm Listesi** — tarih sıralama, bölüm içi arama, indirme butonu
- **Çoklu Tema** — Koyu, Açık, OLED Siyah; 7 vurgu rengi
- **Çok Dilli** — TR / EN / DE / FR / ES / AR / JA / RU (RTL dahil)
- **PWA** — "Ana Ekrana Ekle" desteği; Service Worker ile offline erişim

---

## Kullanım

Doğrudan tarayıcıda açın — build adımı gerekmez:

```bash
# Geliştirme için basit HTTP sunucu
npx serve .
# veya
python -m http.server 8080
```

Ya da repository'i fork edin ve **GitHub Pages**'i etkinleştirin:
`Settings → Pages → Branch: main / root`

---

## Dosya Yapısı

```
.
├── index.html        # Uygulama (tek dosya — CSS + JS dahil)
├── manifest.json     # PWA manifest
├── sw.js             # Service Worker (cache-first)
├── icons/
│   ├── icon-192.png  # PWA ikonu 192×192
│   └── icon-512.png  # PWA ikonu 512×512
└── README.md
```

---

## Teknoloji

- Vanilla JS (ES2022) — framework yok, build araçı yok
- [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/)
- Web Audio API (`<audio>`)
- Cache API + Service Worker

---

## Lisans

MIT
