// Builds the circuit outline, pit lane and pit boxes for every circuit in the given seasons and checks they are sane.
// Run: node test-circuits.js 2025 2023 2019      (needs f1-token.txt)
const fs = require('fs'), pl = require('./pitlane.js');
const { readToken } = require('./f1feed.js');
const years = process.argv.slice(2).map(Number).filter(Boolean); if (!years.length) years.push(2025);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const plen = a => { let s = 0; for (let i = 1; i < a.length; i++) s += dist(a[i], a[i - 1]); return s; };
function nearest(p, poly) { let b = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], c = poly[(i + 1) % poly.length], dx = c[0] - a[0], dy = c[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); b = Math.min(b, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)); } return b; }
(async () => {
  const token = readToken(); if (!token) { console.log('no token'); process.exit(1); }
  let total = 0, good = 0; const bad = [];
  for (const y of years) {
    let idx; try { idx = JSON.parse((await (await fetch(`https://livetiming.formula1.com/static/${y}/Index.json`, { headers: { Authorization: 'Bearer ' + token } })).text()).replace(/^﻿/, '')).Meetings; } catch { console.log(y, 'no index'); continue; }
    const seen = new Set();
    for (const m of idx) {
      if (!m.Circuit || seen.has(m.Circuit.Key) || /Testing/i.test(m.Name)) continue; seen.add(m.Circuit.Key);
      total++; const t0 = Date.now(); const issues = [];
      let d = null; try { d = await pl.build(token, m.Circuit.Key, y, n => ({ name: 'T' + (n % 10), color: '#888' }), () => { }); } catch (e) { issues.push('error ' + e.message); }
      if (!d) issues.push('no result');
      else {
        const o = d.outline, L = d.lane || [], olen = o ? plen(o.concat([o[0]])) / 10 : 0, llen = plen(L) / 10;
        if (!d.lane) issues.push('outline only (no trustworthy pit lane, none will be drawn)');
        if (!o || o.length < 80) issues.push('outline too short'); else {
          if (olen < 2000 || olen > 8500) issues.push(`outline length ${Math.round(olen)} m is odd`);
          if (dist(o[0], o[o.length - 1]) / 10 > 60) issues.push('outline does not close');
          if (L.length && (nearest(L[0], o) > 40 || nearest(L[L.length - 1], o) > 40)) issues.push('pit lane ends are not on the circuit');
        }
        if (L.length && (llen < 150 || llen > 1100)) issues.push(`pit lane ${Math.round(llen)} m is odd`);
        if (L.length && d.boxes.length < 8) issues.push(`only ${d.boxes.length} pit boxes`);
        const jumps = L.filter((p, i) => i && dist(p, L[i - 1]) > 400).length; if (jumps) issues.push('pit lane has gaps');
      }
      if (issues.length) bad.push(`${y} ${m.Name}: ${issues.join('; ')}`); else good++;
      console.log(`${y} ${m.Name.padEnd(30)} ${issues.length ? 'CHECK: ' + issues.join('; ') : 'ok'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }
  console.log(`\n${good} of ${total} circuits look right`);
  if (bad.length) { console.log('\nto look at:'); bad.forEach(b => console.log(' - ' + b)); }
})();
