// Traces the real pit lane and each team's pit box from F1's recorded session data (the public archive,
// read with your F1 TV token). Practice and qualifying are full of trips through the pit lane, so one
// recorded session is enough. The result is cached on disk per circuit.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { stamp, rest } = require('./stamp');
const BASE = 'https://livetiming.formula1.com/static/';
const DIR = path.join(process.env.PP_DATA_DIR || __dirname, 'data');
const cacheFile = key => path.join(DIR, `pitlane2-${key}.json`);
const keyOf = (circuitKey, year) => `${circuitKey}-${year}`;

async function get(token, p) {
  const r = await fetch(BASE + p, { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return (await r.text()).replace(/^﻿/, '');
}
const lines = t => t.split(/\r?\n/).filter(Boolean);
const clock = l => { const s = stamp(l); return s ? s.ms : NaN; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// per-driver position samples, with times on the session clock (ms since the recording started)
function readPositions(txt) {
  const tracks = {}; let off = null;
  for (const l of lines(txt)) {
    let msg; try { msg = JSON.parse(zlib.inflateRawSync(Buffer.from(JSON.parse(rest(l)), 'base64')).toString()); } catch { continue; }
    const ct = clock(l);
    for (const p of msg.Position || []) {
      const utc = Date.parse(p.Timestamp);
      if (off === null) off = utc - ct;            // session clock -> UTC
      for (const [n, c] of Object.entries(p.Entries || {})) {
        if (!c.X && !c.Y) continue;
        (tracks[n] || (tracks[n] = [])).push({ t: utc - off, x: c.X, y: c.Y });
      }
    }
  }
  for (const n in tracks) tracks[n].sort((a, b) => a.t - b.t);
  return tracks;
}

// stretches where a driver was in the pit lane: InPit true ... InPit false
function readPitIntervals(txt) {
  const open = {}, out = [];
  for (const l of lines(txt)) {
    if (!l.includes('"InPit"')) continue;
    let m; try { m = JSON.parse(rest(l)); } catch { continue; }
    const t = clock(l);
    for (const [n, v] of Object.entries(m.Lines || {})) {
      if (v.InPit === true && open[n] == null) open[n] = t;
      else if (v.InPit === false && open[n] != null) { out.push({ n, t1: open[n], t2: t }); delete open[n]; }
    }
  }
  return out;
}

const plen = a => { let s = 0; for (let i = 1; i < a.length; i++) s += dist(a[i], a[i - 1]); return s; };

// the car stood still in its box: the longest run of (almost) unchanged positions
function stationary(s) {
  let best = null, i = 0;
  while (i < s.length) {
    let j = i; while (j + 1 < s.length && dist(s[j + 1], s[i]) < 30) j++;
    if (s[j].t - s[i].t >= 1200 && (!best || s[j].t - s[i].t > best.d)) best = { i, j, d: s[j].t - s[i].t };
    i = j + 1;
  }
  if (!best) return null;
  const run = s.slice(best.i, best.j + 1);
  return { x: run.reduce((a, p) => a + p.x, 0) / run.length, y: run.reduce((a, p) => a + p.y, 0) / run.length, i: best.i, j: best.j, d: best.d };
}
const median = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };

// every trip through the pit lane in one session: the car's path, and where (if anywhere) it stood still
function collectStops(tracks, intervals) {
  const stops = [];
  for (const iv of intervals) {
    const dur = (iv.t2 - iv.t1) / 1000;
    if (dur < 12 || dur > 120 || !tracks[iv.n]) continue;
    const s = tracks[iv.n].filter(p => p.t >= iv.t1 - 2500 && p.t <= iv.t2 + 2500);
    if (s.length < 12) continue;
    const st = stationary(s);
    stops.push({ n: iv.n, s, st: st && st.d <= 25000 ? st : null, len: plen(s) });
  }
  return stops;
}

// ---- the lane itself ----
// A car that pits drives along the circuit, leaves it, runs down the pit lane, and rejoins. Only the part away
// from the racing line is the pit lane. We cut that part out of every stop, line them up, and take the middle of
// all of them, so one car's detour into its garage cancels out. The ends are joined to the circuit outline.
function distToLoop(p, poly) {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L ? ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy)); if (d < best) best = d;
  }
  return best;
}
function nearestOnLoop(p, poly) {
  let best = Infinity, q = poly[0];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L ? ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx, y = a[1] + t * dy, d = Math.hypot(p.x - x, p.y - y); if (d < best) { best = d; q = [x, y]; }
  }
  return q;
}
function resample(pts, n) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  const L = cum[cum.length - 1], out = []; let k = 0;
  for (let i = 0; i < n; i++) {
    const d = L * i / (n - 1); while (k < cum.length - 2 && cum[k + 1] < d) k++;
    const f = (d - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
    out.push({ x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f });
  }
  return out;
}
// the part of one stop that is away from the racing line (distance threshold in map units, 10 = 1 m)
function offTrackPart(s, st, outline, thr) {
  const pts = st ? s.filter((p, k) => k <= st.i || k > st.j) : s;       // drop the standing-still samples
  if (pts.length < 10) return null;
  const off = pts.map(p => distToLoop(p, outline) > thr);
  let best = null, a = -1, gap = 0;
  for (let k = 0; k <= pts.length; k++) {
    if (k < pts.length && off[k]) { if (a < 0) a = k; gap = 0; }
    else if (a >= 0) { gap++; if (gap > 2 || k === pts.length) { const b = k - gap; if (!best || b - a > best[1] - best[0]) best = [a, b]; a = -1; gap = 0; } }
  }
  if (!best) return null;
  const from = Math.max(0, best[0] - 2), to = Math.min(pts.length - 1, best[1] + 2);  // a couple of samples either side, to meet the track
  const part = pts.slice(from, to + 1);
  const len = plen(part);
  return len > 1200 && len < 12000 ? { part, len } : null;
}
function laneFrom(stops, outline) {
  if (!outline || outline.length < 50) return null;
  for (const thr of [70, 50, 35]) {
    const parts = stops.map(x => offTrackPart(x.s, x.st, outline, thr)).filter(Boolean);
    if (parts.length < 5) continue;
    const med = median(parts.map(x => x.len));
    const good = parts.filter(x => Math.abs(x.len - med) < med * .25);   // drop stops that did something odd
    if (good.length < 4) continue;
    const N = 70, rs = good.map(x => resample(x.part, N)), mid = [];
    for (let i = 0; i < N; i++) mid.push({ x: median(rs.map(r => r[i].x)), y: median(rs.map(r => r[i].y)) });
    const a = nearestOnLoop(mid[0], outline), b = nearestOnLoop(mid[N - 1], outline);
    const lane = [{ x: a[0], y: a[1] }, ...mid, { x: b[0], y: b[1] }];
    return lane.map(p => [Math.round(p.x), Math.round(p.y)]);
  }
  return null;
}

// box of each team: the middle of where its cars stopped, over every session read so far
function addBoxes(agg, stops, teamOf) {
  for (const x of stops) {
    if (!x.st) continue; const t = teamOf(x.n); if (!t) continue;
    const b = agg[t.name] || (agg[t.name] = { team: t.name, color: t.color, xs: [], ys: [] });
    b.xs.push(x.st.x); b.ys.push(x.st.y);
  }
}
const boxList = agg => Object.values(agg).map(b => ({ team: b.team, color: b.color, x: Math.round(median(b.xs)), y: Math.round(median(b.ys)), seen: b.xs.length }));

// the circuit itself: one clean lap of one car, out of the pit lane, closed back on its start
function outlineFrom(tracks, intervals) {
  const inPit = (n, t) => intervals.some(iv => iv.n === n && t >= iv.t1 - 2000 && t <= iv.t2 + 2000);
  const cands = [];
  for (const n of Object.keys(tracks)) {
    const T = tracks[n].filter(p => !inPit(n, p.t));
    const runs = []; let cur = [];
    for (const p of T) { if (cur.length && p.t - cur[cur.length - 1].t > 5000) { runs.push(cur); cur = []; } cur.push(p); }
    runs.push(cur);
    for (const r of runs) {
      if (r.length < 150) continue;
      const xs = r.map(p => p.x), ys = r.map(p => p.y), size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      let far = false;
      for (let k = 1; k < r.length; k++) {
        const d = dist(r[k], r[0]);
        if (d > size * .25) far = true;
        if (far && d < size * .02 && k > 100) {
          const lap = r.slice(0, k + 1);
          let jump = false; for (let q = 1; q < lap.length; q++) if (dist(lap[q], lap[q - 1]) > size * .06) { jump = true; break; }
          if (!jump) cands.push(lap);
          break;
        }
      }
      if (cands.length && cands[cands.length - 1] === undefined) cands.pop();
    }
    if (cands.length >= 12) break;
  }
  if (!cands.length) return null;
  const med = median(cands.map(plen));
  const lap = cands.sort((a, b) => Math.abs(plen(a) - med) - Math.abs(plen(b) - med))[0];
  const out = [];
  for (const p of lap) { const q = out[out.length - 1]; if (!q || dist(p, q) > 40) out.push({ x: p.x, y: p.y }); }
  return out.map(p => [Math.round(p.x), Math.round(p.y)]);
}

// Sanity gates: a wrong guess drawn on the map is worse than nothing.
function outlineSane(o) {
  if (!o || o.length < 80) return false;
  const len = plen(o.map(p => ({ x: p[0], y: p[1] }))) / 10;                   // metres
  const gap = Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) / 10;
  return len > 1800 && len < 9000 && gap < 60;                                 // a circuit is 2-8 km and the lap closes
}
function laneSane(lane, outline) {
  if (!lane || lane.length < 20) return false;
  const pts = lane.map(p => ({ x: p[0], y: p[1] })), len = plen(pts) / 10;
  if (len < 150 || len > 1100) return false;                                    // pit lanes are roughly 200-1000 m
  for (let i = 1; i < pts.length; i++) if (dist(pts[i], pts[i - 1]) > 400) return false; // no gaps or jumps
  const near = p => distToLoop(p, outline);
  return near(pts[0]) < 40 && near(pts[pts.length - 1]) < 40;                   // starts and ends on the circuit
}

// look through this weekend's sessions (then last year's) for the lane and every team's box
async function build(token, circuitKey, year, teamOf, log = console.log) {
  const index = async y => JSON.parse(await get(token, `${y}/Index.json`)).Meetings || [];
  const agg = {}; let lane = null, outline = null, source = '', used = 0;
  const tryYears = [...new Set([year, year + 1, year + 2, 2023, 2025, year - 1].filter(y => y >= 2018 && y <= new Date().getFullYear()))];
  for (const y of tryYears) {
    let meetings; try { meetings = await index(y); } catch (e) { log('pit lane: no index for', y, e.message); continue; }
    const sessions = [];
    for (const m of meetings) if (m.Circuit && String(m.Circuit.Key) === String(circuitKey))
      for (const s of m.Sessions || []) if (s.Path && /Practice|Qualifying|Race|Sprint/.test(s.Type || s.Name)) sessions.push({ ...s, meeting: m.Name });
    // practice first (most pit lane trips), the race last (its archive is only filled in after the session)
    const rank = s => /Practice/.test(s.Name) ? 0 : /Qualifying/.test(s.Name) ? 1 : /Sprint/.test(s.Name) ? 2 : 3;
    sessions.sort((a, b) => rank(a) - rank(b));
    for (const s of sessions) {
      try {
        log('pit lane: reading', s.meeting, s.Name);
        const [pos, tim] = await Promise.all([get(token, s.Path + 'Position.z.jsonStream'), get(token, s.Path + 'TimingData.jsonStream')]);
        const tracks = readPositions(pos), intervals = readPitIntervals(tim), stops = collectStops(tracks, intervals);
        if (!outline) { const o = outlineFrom(tracks, intervals); if (outlineSane(o)) outline = o; }
        if (!lane && outline) { const l = laneFrom(stops, outline); if (laneSane(l, outline)) { lane = l; source = `${s.meeting} ${s.Name} (${y})`; } }
        used += stops.length; addBoxes(agg, stops, teamOf);
      } catch (e) { log('pit lane:', s.Name, e.message); }
    }
    if (lane && outline) break; // good enough; other seasons only if this one gave nothing usable
  }
  if (!outline) return null;
  return { circuit: circuitKey, source: source || 'outline only', lane: lane || null, outline, boxes: lane ? boxList(agg) : [], stops: used };
}

const state = {}; // circuitKey -> {status, data}
function ensure(token, circuitKey, year, teamOf, log) {
  const K = keyOf(circuitKey, year);
  if (state[K]) return;
  state[K] = { status: 'building', data: null };
  try { const c = JSON.parse(fs.readFileSync(cacheFile(K), 'utf8')); if (c && c.outline && c.outline.length > 50) { state[K] = { status: 'ready', data: c }; return; } } catch { }
  build(token, circuitKey, year, teamOf, log).then(d => {
    if (d) { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(cacheFile(K), JSON.stringify(d)); } catch { } state[K] = { status: 'ready', data: d }; (log || console.log)(`pit lane: ready (${d.source}, ${d.lane ? d.lane.length : 0} lane points, ${d.boxes.length} team boxes)`); }
    else { state[K] = { status: 'none', data: null }; (log || console.log)('pit lane: no usable session found'); setTimeout(() => { delete state[K]; }, 10 * 60e3); }
  }).catch(e => { state[K] = { status: 'none', data: null }; (log || console.log)('pit lane failed:', e.message); setTimeout(() => { delete state[K]; }, 10 * 60e3); });
}
// after a new login: forget "nothing found" answers so they are tried again
const forget = () => { for (const k of Object.keys(state)) if (state[k].status !== 'ready') delete state[k]; };
const result = (circuitKey, year) => { const s = state[keyOf(circuitKey, year)]; return s && s.data ? [s.data] : []; };

module.exports = { ensure, result, forget, build, readPositions, readPitIntervals };
