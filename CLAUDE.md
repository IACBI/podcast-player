# Seseri — working notes

Vite + TypeScript SPA, no UI framework. `src/ui/h.ts` builds DOM,
`src/state/signals.ts` is the entire reactivity layer, `worker/` is an optional
Cloudflare Worker (Hono) that proxies RSS and iTunes. Ships as a PWA to GitHub
Pages, plus a Tauri Windows shell in `desktop/`.

`README.md` describes the product and the layout; `CONTRIBUTING.md` has the
rules a human contributor needs. This file is only the things that are easy to
get wrong from the outside.

## The gate

```bash
npm run verify   # lint + typecheck + unit tests + build + worker typecheck/tests
```

Run it before claiming anything works. `npm run dev` serves on **5199**.

## Traps

- **Do not run `prettier --write` across the repo.** It is not uniformly
  formatted, and a broad run rewrites ~60 untouched files into the diff. Format
  only what you edited.
- **Vite HMR forks module instances.** After an edit, `import('/src/x.ts')` from
  the console gets a *different* copy than the running app imported
  (`/src/x.ts?t=…`), so writes to it appear to do nothing. Restart the dev
  server for a clean read, or measure through the DOM instead.
- **The `<audio>` element is not in the DOM** — `new Audio()` in
  `src/player/engine.ts`. Nothing can query for it.
- **The Now Playing sheet is never `display:none`.** Closed means
  `visibility:hidden`, so its measurements stay valid — but it also means the
  sheet deliberately skips `timeupdate` work while closed. Read playback time
  from the mini dock (`#miniScrub`) when the sheet is shut.
- Feed lists render as `.ep-item`, not `.row`.

## Invariants

- **Feed data reaches the DOM only through `h()` or `textContent`.** `innerHTML`
  is for static constants only; ESLint fails interpolation, concatenation,
  `insertAdjacentHTML` and `eval`.
- **Every user-visible string exists in all 8 languages** — a key in
  `src/i18n/types.ts` plus `src/i18n/langs/{tr,en,de,fr,es,ar,ja,ru}.ts`. A
  missing one is a compile error.
- **Styling uses tokens and logical properties.** No literal colours or `left`/
  `right`; RTL is expected to work and is checked with `ar`.
- **A new setting** needs a field, a default, and — unless free-form — an entry
  in `ALLOWED` (`src/state/settings.ts`), which is what keeps a tampered
  `localStorage` value out of the DOM and the audio element.
- **A new external origin** means editing the CSP in `index.html`. Anything that
  changes the app's exposure belongs in `SECURITY.md` too.

## Verifying at the UI

Unit tests do not cover layout or playback wiring. The headless smokes do, and
they need Edge at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`:

```bash
node scripts/smoke-p5-mini.cjs      # dock, queue, back-navigation
node scripts/smoke-p3-offline.cjs   # download → offline reload → playback
node scripts/smoke-live.cjs         # the deployed site against real CDNs
```

`smoke-live.cjs` is the only one that exercises a third-party audio host, which
is where CSP mistakes show up — a local run is always same-origin.

Reference screenshots: `node scripts/shot.cjs` (docs) and
`node scripts/store-shots.cjs` (the manifest's install screenshots). Regenerate
both when the UI changes.

## Releasing

Patch numbers step one at a time to 99, then roll the minor (`4.1.99` → `4.2.0`).

1. Bump `package.json`, `desktop/package.json`,
   `desktop/src-tauri/tauri.conf.json` and the two lockfiles' top-level version.
2. Add a `CHANGELOG.md` section; update `README.md` (both languages) and
   `docs/TESTPLAN.md` for anything that changed behaviour.
3. Commit as `release: X.Y.Z — …`, push, then push tag `vX.Y.Z`.
4. The tag builds the Tauri installer and opens a **draft** GitHub Release.
   Fill it in with Turkish and English sections, then publish.
