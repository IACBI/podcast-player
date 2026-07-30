/* Measures how often the Worker can hand back a REAL audio stream for a
 * YouTube video — the number that decides whether the `youtube-nocookie`
 * embed fallback can be removed.
 *
 * Why it matters: only the audio path is ad-free AND keeps playing with the
 * screen off. The embed does neither. Removing it is only defensible if the
 * audio path almost always wins.
 *
 * Deliberately not instrumented inside the Worker: the response already says
 * everything, so this needs no production code, no KV writes and no extra
 * endpoint to delete afterwards.
 *
 *   node scripts/yt-resolve-rate.cjs [apiBase] [idsFile]
 *
 * apiBase defaults to the production Worker. idsFile is one video id per line
 * (blank lines and `#` comments ignored); without it the built-in sample runs.
 *
 * Outcomes:
 *   innertube  audioUrl points at our own /v1/yt/audio proxy — IP-bound
 *              googlevideo stream, ad-free, range-proxied, works locked.
 *   pool       audioUrl points at a public Piped instance — ad-free too, but
 *              the instance can vanish at any time.
 *   none       502 — the app would fall back to the ad-carrying embed.
 */
const fs = require('fs');

const API = (process.argv[2] || 'https://seseri-api.bozdogancanahmet.workers.dev').replace(/\/+$/, '');
const IDS_FILE = process.argv[3];
const ORIGIN = 'https://iacbi.github.io';

/* A spread of ages, lengths and popularity — a sample of only fresh, popular
 * uploads would flatter the result, since those are the ones that resolve. */
const SAMPLE = [
  'jNQXAC9IVRw', 'dQw4w9WgXcQ', '9bZkp7q19f0', 'kJQP7kOldOA', 'fJ9rUzIMcZQ',
  'hTWKbfoikeg', 'YQHsXMglC9A', 'CevxZvSJLk8', '09R8_2nJtjg', 'RgKAFK5djSk',
  'OPf0YbXqDm0', 'lp-EO5I60KA', 'e-ORhEE9VVg', 'ktvTqknDobU', 'JGwWNGJdvx8',
  'nfWlot6h_JM', 'pRpeEdMmmQ0', 'SlPhMPnQ58k', 'uelHwf8o7_U', 'ItZQTvf7ge0',
  '2Vv-BfVoq4g', 'PT2_F-1esPk', 'tt2k8PGm-TI', 'oyEuk8j8imI', 'rYEDA3JcQqw',
  'ru0K8uYEZWw', 'YykjpeuMNEk', '60ItHLz5WEA', 'papuvlVeZg8', '450p7goxZqg',
];

function ids() {
  if (!IDS_FILE) return SAMPLE;
  return fs
    .readFileSync(IDS_FILE, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

async function resolveOne(id) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API}/v1/yt/resolve?id=${encodeURIComponent(id)}`, {
      headers: { origin: ORIGIN },
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { id, outcome: 'none', ms, detail: 'HTTP ' + res.status };
    const j = await res.json();
    if (!j.audioUrl) return { id, outcome: 'none', ms, detail: 'no audioUrl' };
    const own = j.audioUrl.startsWith(API + '/v1/yt/audio');
    return { id, outcome: own ? 'innertube' : 'pool', ms, detail: new URL(j.audioUrl).host };
  } catch (e) {
    return { id, outcome: 'none', ms: Date.now() - t0, detail: e.message };
  }
}

(async () => {
  const list = ids();
  console.log(`API      ${API}`);
  console.log(`videos   ${list.length}\n`);

  const rows = [];
  for (const id of list) {
    const r = await resolveOne(id);
    rows.push(r);
    console.log(`${r.outcome.padEnd(9)} ${id}  ${String(r.ms).padStart(6)}ms  ${r.detail}`);
  }

  const count = (o) => rows.filter((r) => r.outcome === o).length;
  const playable = count('innertube') + count('pool');
  const pct = (n) => ((n / rows.length) * 100).toFixed(1) + '%';

  console.log('\n================ RESULT ================');
  console.log(`innertube (own proxy)  ${count('innertube')}  ${pct(count('innertube'))}`);
  console.log(`pool (public Piped)    ${count('pool')}  ${pct(count('pool'))}`);
  console.log(`none (would use embed) ${count('none')}  ${pct(count('none'))}`);
  console.log(`\nAD-FREE + BACKGROUND RATE: ${pct(playable)}`);
  console.log(
    playable / rows.length >= 0.95
      ? '\n>= 95%: removing the embed fallback is defensible.'
      : '\n< 95%: keep the embed, but behind an explicit opt-in with a clear warning.',
  );

  const failed = rows.filter((r) => r.outcome === 'none');
  if (failed.length) {
    console.log('\nFailures (check `wrangler tail` for the tubeAudio reason):');
    for (const r of failed) console.log(`  ${r.id}  ${r.detail}`);
  }
})();
