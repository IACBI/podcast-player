# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.
Instead, use GitHub's private vulnerability reporting
(*Security → Report a vulnerability* on the repository page) or contact the
maintainer directly.

You can expect an initial response within a week.

## Scope

- **Client:** no accounts, no cookies — settings/progress live in
  `localStorage`, feed cache and download metadata in IndexedDB, downloaded
  audio in the Cache API. External requests go to `itunes.apple.com`, the
  optional Seseri Worker, Piped/Invidious instances (listing only), Google
  Fonts, and podcast hosts' own CDNs. The public CORS proxies
  (allorigins/codetabs/corsproxy) are **opt-in and off by default** — see
  below. A strict Content Security Policy (no `'unsafe-inline'` scripts, no
  frames at all) is declared in `index.html`; remote data is only inserted
  through a typed DOM builder. Values restored from `localStorage` are
  validated against an allow-list before reaching CSS custom properties or the
  media element.
- **Worker (`worker/`):** a stateless proxy on Cloudflare. Feeds whose URL
  carries a subscriber credential are served with `Cache-Control: no-store` and
  never written to the shared edge cache. The YouTube audio proxy is rate
  limited per IP regardless of the `Range` header, and answers a ranged request
  with at most 16 MB so one request cannot exhaust the subrequest budget. It
  enforces an SSRF guard on user-supplied URLs (re-validated on every redirect hop —
  redirects are followed manually, max 3 hops, and each `Location` target must
  pass the same private-host checks), response size caps, an app-origin
  requirement so the proxy endpoints cannot be used as an open proxy, and
  per-IP rate limiting; it stores no user data. The SSRF check parses
  addresses rather than pattern-matching them, so IPv4-mapped IPv6
  (`::ffff:169.254.169.254`), the unspecified address, CGNAT `100.64/10`,
  link-local and NAT64-embedded private addresses are all rejected.
- **Private (paid) feeds:** services like Patreon, Memberful and Substack put a
  subscriber token in the feed URL itself. Such URLs are never sent to the
  public CORS proxies — they go only to the app's own Worker, and the feed
  fails with an explanatory message if no Worker is configured. Ordinary public
  feeds are unaffected.

## Known residual risks

- The SSRF guard is hostname-based; it cannot resolve DNS, so a hostname that
  *resolves* to a private address (DNS-rebinding style) is not fully
  preventable inside Workers. Cloudflare's own egress restrictions on
  RFC 1918 space mitigate this in practice.
- The Windows installer is currently unsigned (SmartScreen warning expected)
  pending a code-signing certificate.
- Credential detection for private feeds is tuned for precision: it inspects
  query parameters and embedded userinfo, but not path segments, because public
  feeds legitimately carry opaque ids and UUIDs in their paths
  (`feeds.acast.com/public/shows/<uuid>`). A service that puts its token only
  in the path is therefore still proxied. Configure the Worker
  (`VITE_API_BASE`) to avoid the public proxies entirely.
- `frame-ancestors` cannot be enforced: it is ignored in a `<meta>` CSP by
  specification, and GitHub Pages cannot set response headers. The app is
  therefore framable by other origins. Putting the Worker (or any host that can
  set headers) in front of the site is the only fix.
- Public CORS proxies, **when the user turns them on**, see the URL of every
  *public* feed opened, and the app races three of them and parses whichever
  answers first — so any one of them can alter the XML, enclosure URLs
  included. They are off by default and exist only as a fallback for when the
  Worker is unreachable; configuring the Worker removes the third parties from
  the path entirely.
- Piped and Invidious are no longer contacted at all. Every listing endpoint
  they expose was measured dead as well (502/403 from this machine and from
  Cloudflare), so YouTube listing, search and audio now all come from the
  Worker's own Innertube session and twelve upstream origins left both CSPs.
- YouTube videos with no resolvable audio stream cannot be played at all. This
  is deliberate: the previous `youtube-nocookie` iframe fallback played ads and
  stopped when the screen locked, which is the opposite of what the app
  promises. Run `node scripts/yt-resolve-rate.cjs` to measure the current rate.

Reports about XSS via podcast/RSS metadata, CSP bypasses, Service Worker
cache poisoning, or Worker SSRF/validation gaps are especially appreciated.
