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
  optional Seseri Worker, public CORS proxies (allorigins/codetabs/corsproxy),
  Piped/Invidious instances, Google Fonts, and podcast hosts' own CDNs. A
  strict Content Security Policy (no `'unsafe-inline'` scripts) is declared in
  `index.html`; remote data is only inserted through a typed DOM builder.
- **Worker (`worker/`):** a stateless proxy on Cloudflare. It enforces an
  SSRF guard on user-supplied URLs (re-validated on every redirect hop —
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
- Public CORS proxies see the URL of every *public* feed the user opens. This is
  inherent to fetching feeds that send no CORS headers from a static site;
  configuring the Worker removes the third parties from the path.

Reports about XSS via podcast/RSS metadata, CSP bypasses, Service Worker
cache poisoning, or Worker SSRF/validation gaps are especially appreciated.
