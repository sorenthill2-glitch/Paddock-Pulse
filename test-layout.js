// Checks every panel combination at several window sizes: nothing overlaps, nothing leaves the window,
// timing keeps full height, and every panel stays a usable size. Run: node test-layout.js
const { computeLayout } = require('./layout.js');
const KEYS = ['timing', 'map', 'tiles', 'rc', 'radio', 'watch'];
const MINS = { timing: [300, 400], map: [260, 200], tiles: [300, 160], rc: [240, 120], radio: [240, 120], watch: [240, 120] };
const sizes = [[1280, 680], [1366, 720], [1440, 850], [1920, 1032], [2560, 1392]];
let total = 0, bad = 0, tvTotal = 0, tvOff = 0; const fails = {};
for (const [W, H] of sizes) {
  for (let tv = 0; tv <= 4; tv++) for (let mask = 0; mask < 64; mask++) {
    const vis = { tv }; KEYS.forEach((k, i) => vis[k] = !!(mask >> i & 1));
    if (!mask && !tv) continue;
    total++;
    const L = computeLayout(vis, W, H, {}); const errs = [];
    const want = KEYS.filter(k => vis[k]).concat(Array.from({ length: tv }, (_, i) => 'tv' + (i + 1)));
    for (const k of want) if (!L[k]) errs.push('missing ' + k);
    for (const k of Object.keys(L)) if (!want.includes(k)) errs.push('extra ' + k);
    const ids = Object.keys(L);
    for (const a of ids) {
      const r = L[a], min = a.startsWith('tv') ? [300, 170] : MINS[a];
      if (r.x < 0 || r.y < 0 || r.x + r.w > W + 1 || r.y + r.h > H + 1) errs.push(a + ' outside');
      if (r.w < min[0] || r.h < min[1]) errs.push(`${a} small ${r.w}x${r.h}`);
    }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = L[ids[i]], b = L[ids[j]];
      if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) errs.push(`overlap ${ids[i]}/${ids[j]}`);
    }
    for (const k of ids) if (k.startsWith('tv')) { tvTotal++; const r = L[k], ratio = r.w / (r.h - 34); if (Math.abs(ratio / (16 / 9) - 1) > .06) tvOff++; }
    if (vis.timing && L.timing && L.timing.h < H - 17) errs.push('timing cut');
    if (errs.length) { bad++; const key = `${W}x${H}`; (fails[key] = fails[key] || []).push(`tv${tv} mask${mask.toString(2).padStart(6, '0')}: ` + errs.slice(0, 2).join(', ')); }
  }
}
console.log(`combinations per window size: ${total / sizes.length}  (6 panels on/off x 0-4 F1 TV boxes, minus the empty one)`);
console.log(`checked ${total} layouts, ${bad} with problems`);
console.log(`F1 TV boxes with a 16:9 video area (within 6%): ${tvTotal - tvOff} of ${tvTotal}`);
for (const k of Object.keys(fails)) { console.log(`\n${k}: ${fails[k].length} problems`); fails[k].slice(0, 6).forEach(x => console.log('  ' + x)); }
