// Replays a recorded F1 session through the same OpenF1-shaped interface the live feed uses.
// F1 keeps a recording of every session (read with your F1 TV token). We download one, then act like a
// live feed whose clock you control: play/pause, speed, jump anywhere. Times handed to the dashboard are
// shifted so the session looks like it is happening "now".
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const tick = () => new Promise(r => setImmediate(r));   // let the server answer requests in the middle of a long parse
const { stamp, rest } = require('./stamp');
const { createCore, filterRows, isoZ } = require('./feedcore');
const pitlane = require('./pitlane');
const { tokenExpired } = require('./f1feed');
const BASE = 'https://livetiming.formula1.com/static/';
const fs = require('fs'), nodePath = require('path');

// Finished recordings never change, so keep a compressed copy on disk: opening the same session again is instant instead of a
// 20-25 MB download. Only sessions more than 3 days old are kept (a fresh one may still be incomplete), capped at ~1 GB.
const CACHE = nodePath.join(process.env.PP_DATA_DIR || __dirname, 'data', 'replay-cache'), CACHE_MAX = 1024 * 1024 * 1024;
const cacheFile = p => nodePath.join(CACHE, p.replace(/[^A-Za-z0-9._-]+/g, '_') + '.gz');
const cacheable = p => { const m = /^(?:\d{4})\/(\d{4}-\d{2}-\d{2})_/.exec(p); return !!m && Date.now() - Date.parse(m[1] + 'T00:00:00Z') > 3 * 864e5; };
async function cacheGet(p) {
  if (!cacheable(p)) return null;
  try { return (await gunzip(await fs.promises.readFile(cacheFile(p)))).toString(); } catch { return null; }
}
async function cachePut(p, text) {
  if (!cacheable(p) || !text) return;
  try {
    await fs.promises.mkdir(CACHE, { recursive: true });
    const f = cacheFile(p), tmp = f + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, await gzip(text)); await fs.promises.rename(tmp, f);
  } catch { /* the cache is only a speed-up */ }
}
async function cacheTrim() {
  try {
    const files = await Promise.all((await fs.promises.readdir(CACHE)).map(async n => { const f = nodePath.join(CACHE, n), st = await fs.promises.stat(f); return { f, size: st.size, t: st.mtimeMs }; }));
    let total = files.reduce((a, x) => a + x.size, 0);
    for (const x of files.sort((a, b) => a.t - b.t)) { if (total <= CACHE_MAX) break; await fs.promises.unlink(x.f).catch(() => { }); total -= x.size; }
  } catch { }
}

const indexCache = {};
async function fetchText(token, p, optional, cancel) {
  const hit = await cacheGet(p); if (hit) return hit;
  let r;
  try { r = await fetch(BASE + p, { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: cancel ? AbortSignal.any([cancel, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) }); }   // never wait forever on a stalled connection
  catch (e) { if (optional && !(cancel && cancel.aborted)) return ''; throw new Error(cancel && cancel.aborted ? 'cancelled' : `${p}: ${e.name === 'TimeoutError' ? 'timed out' : 'network error'}`); }
  if (r.status === 401 || r.status === 403) {
    if (optional) return '';
    // 403 on one file while the login is still valid means F1 has no such recording (2018 Bahrain has no car positions)
    if (token && !tokenExpired()) throw new Error(/Position\.z/.test(p) ? 'F1 has no car-position recording for this session.' : `F1 has no recording for this session (${p.split('/').pop()}).`);
    throw new Error('F1 refused the login (it may have expired). Click "F1 login" in the header and paste a fresh one.');
  }
  if (!r.ok) { if (optional) return ''; throw new Error(`${p}: HTTP ${r.status}`); }
  const text = (await r.text()).replace(/^﻿/, '');
  cachePut(p, text);
  return text;
}
const lines = t => t.split(/\r?\n/).filter(Boolean);
const clock = l => { const s = stamp(l); return s ? s.ms : null; };
const body = l => { try { return JSON.parse(rest(l)); } catch { return null; } };
const unz = s => JSON.parse(zlib.inflateRawSync(Buffer.from(s, 'base64')).toString());

// ---- which sessions exist (F1's own index) ----
async function index(token, year) {
  if (indexCache[year] && Date.now() - indexCache[year].t < 10 * 60e3) return indexCache[year].data;
  const j = JSON.parse(await fetchText(token, `${year}/Index.json`));
  const now = Date.now();
  const meetings = (j.Meetings || []).map(m => ({
    key: m.Key, name: m.Name, official: m.OfficialName, location: m.Location, country: m.Country && m.Country.Name, circuitKey: m.Circuit && m.Circuit.Key,
    sessions: (m.Sessions || []).filter(s => s.Path && Date.parse(s.StartDate + 'Z') < now).map(s => ({ key: s.Key, name: s.Name, type: s.Type, start: s.StartDate, path: s.Path })),
  })).filter(m => m.sessions.length);
  meetings.sort((a, b) => a.sessions[0].start < b.sessions[0].start ? -1 : 1);
  indexCache[year] = { t: Date.now(), data: meetings };
  return meetings;
}

class Replay {
  constructor(token, meta) {
    this.token = token; this.meta = meta;
    this.ready = false; this.loading = true; this.error = null; this.progress = 'Starting';
    this.speed = 1; this.playing = true;
    this.anchorReal = Date.now(); this.anchorReplay = 0;
    this.ac = new AbortController();   // aborted when the replay is cancelled or replaced: stops the downloads
  }

  async load() {
    const P = this.meta.path, steps = ['Position.z', 'CarData.z', 'TimingData', 'TimingAppData', 'RaceControlMessages', 'TeamRadio', 'WeatherData', 'DriverList', 'LapCount', 'SessionStatus', 'SessionInfo'];
    let done = 0;
    const optional = new Set(['TeamRadio', 'WeatherData', 'LapCount', 'SessionStatus', 'TimingAppData']);
    const txt = {};
    await Promise.all(steps.map(async s => {
      txt[s] = await fetchText(this.token, `${P}${s}.jsonStream`, optional.has(s), this.ac.signal);
      this.progress = `Downloading the recording (${++done} of ${steps.length})`;
    }));
    if (this.ac.signal.aborted) throw new Error('cancelled');
    this.progress = 'Reading the recording';
    // positions + car data, as compact arrays
    const pos = await this.readPositions(txt['Position.z']);
    if (!pos.n) throw new Error('This session has no position data in F1\'s recording yet. Recent sessions are published some time after they finish.');
    await this.readCarData(txt['CarData.z']);
    // everything else becomes a time-ordered list of messages
    const off = this.offset, ev = [];
    for (const name of ['TimingData', 'TimingAppData', 'RaceControlMessages', 'TeamRadio', 'WeatherData', 'LapCount', 'SessionStatus'])
      for (const l of lines(txt[name] || '')) { const t = clock(l); if (t !== null) ev.push({ t: t + off, topic: name, raw: rest(l) }); }
    ev.sort((a, b) => a.t - b.t);
    this.events = ev;
    // a recording can carry a stray fragment from long before the session (the 2026 Mexico City race has one a day earlier): use the longest
    // continuous run of car positions, so the timeline is the session and not the gap
    let from = pos.first, to = pos.last;
    { const T = this.loc.t; let rs = 0, bs = 0, be = T.length - 1, bl = 0;
      for (let i = 1; i <= T.length; i++) if (i === T.length || T[i] - T[i - 1] > 30 * 60e3) { if (i - rs > bl) { bl = i - rs; bs = rs; be = i - 1; } rs = i; }
      if (T.length) { from = T[bs]; to = T[be]; } }
    this.started = null;
    for (const e of ev) if (e.t >= from - 120e3 && e.topic === 'SessionStatus' && /"Status":"Started"/.test(e.raw)) { this.started = e.t; break; }
    this.initial = [];
    for (const name of ['SessionInfo', 'DriverList']) for (const l of lines(txt[name] || '')) { const b = body(l); if (b) this.initial.push({ topic: name, data: b }); }
    this.start = from; this.end = to;
    this.anchorReplay = this.started ? Math.max(this.start, this.started - 90e3) : this.start; // begin just before the lights go out
    this.anchorReal = Date.now();
    this.resetCore();
    const sb = this.core.sessionBase();
    this.circuitKey = sb && sb.circuit_key; this.year = sb && sb.year;
    this.advance(this.anchorReplay);
    // pit lane / boxes / outline for this circuit
    const tok = this.token;
    if (tok && this.circuitKey) pitlane.ensure(tok, this.circuitKey, this.year || this.meta.year, n => { const d = (this.core.state.DriverList || {})[n]; return d && d.TeamName ? { name: d.TeamName, color: '#' + (d.TeamColour || '888888') } : null; }, () => { });
    this.ready = true; this.loading = false; this.progress = 'Ready';
  }

  async readPositions(text) {
    const L = lines(text), T = [], D = [], X = [], Y = [], Z = []; let off = null, li = 0;
    for (const l of L) {
      if (++li % 150 === 0) await tick();
      const ct = clock(l); if (ct === null) continue;
      let m; try { m = unz(JSON.parse(rest(l))); } catch { continue; }
      for (const p of m.Position || []) {
        const utc = Date.parse(p.Timestamp); if (off === null) off = utc - ct;
        for (const [n, c] of Object.entries(p.Entries || {})) { if (!c.X && !c.Y) continue; T.push(utc); D.push(+n); X.push(c.X); Y.push(c.Y); Z.push(c.Z || 0); }
      }
    }
    this.offset = off || 0;
    const idx = Uint32Array.from({ length: T.length }, (_, i) => i); { let sorted = true; for (let i = 1; i < T.length; i++) if (T[i] < T[i - 1]) { sorted = false; break; } if (!sorted) idx.sort((a, b) => T[a] - T[b]); }
    const n = idx.length; this.loc = { n, t: new Float64Array(n), d: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), z: new Int32Array(n) };
    for (let i = 0; i < n; i++) { const k = idx[i]; this.loc.t[i] = T[k]; this.loc.d[i] = D[k]; this.loc.x[i] = X[k]; this.loc.y[i] = Y[k]; this.loc.z[i] = Z[k]; }
    return { n, first: n ? this.loc.t[0] : 0, last: n ? this.loc.t[n - 1] : 0 };
  }
  async readCarData(text) {
    const T = [], D = [], R = [], S = [], G = [], H = [], B = [], DR = [];
    let li = 0;
    for (const l of lines(text)) {
      if (++li % 150 === 0) await tick();
      let m; try { m = unz(JSON.parse(rest(l))); } catch { continue; }
      for (const e of m.Entries || []) { const utc = Date.parse(e.Utc); for (const [n, c] of Object.entries(e.Cars || {})) { const ch = c.Channels || {}; T.push(utc); D.push(+n); R.push(ch[0] || 0); S.push(ch[2] || 0); G.push(ch[3] || 0); H.push(ch[4] || 0); B.push(ch[5] || 0); DR.push(ch[45] || 0); } }
    }
    const idx = Uint32Array.from({ length: T.length }, (_, i) => i); { let sorted = true; for (let i = 1; i < T.length; i++) if (T[i] < T[i - 1]) { sorted = false; break; } if (!sorted) idx.sort((a, b) => T[a] - T[b]); }
    const n = idx.length, f = a => { const o = new Int16Array(n); for (let i = 0; i < n; i++) o[i] = a[idx[i]]; return o; };
    const t = new Float64Array(n); for (let i = 0; i < n; i++) t[i] = T[idx[i]];
    this.car = { n, t, d: f(D), rpm: new Int32Array(n).map((_, i) => R[idx[i]]), speed: f(S), gear: f(G), thr: f(H), brk: f(B), drs: f(DR) };
  }

  // ---- the clock ----
  now() { return this.playing ? Math.min(this.end, this.anchorReplay + (Date.now() - this.anchorReal) * this.speed) : this.anchorReplay; }
  out(replayMs) { return this.anchorReal + (replayMs - this.anchorReplay) / this.speed; }   // replay time -> "now"-shaped time
  inn(shiftedMs) { return this.anchorReplay + (shiftedMs - this.anchorReal) * this.speed; } // and back
  control({ playing, speed, pos }) {
    const cur = this.now();
    this.anchorReplay = Number.isFinite(pos) ? Math.max(this.start, Math.min(this.end, pos)) : cur;
    this.anchorReal = Date.now();
    if (Number.isFinite(speed)) this.speed = Math.max(0.1, Math.min(64, speed));
    if (playing != null) this.playing = !!playing;
  }
  // when the leader started lap n (F1's LapCount feed: the same thing the broadcast's lap counter shows), or null
  lapStart(n) {
    if (!this.lapIdx) {
      this.lapIdx = [];
      for (const e of this.events || []) if (e.topic === 'LapCount') { const m = /"CurrentLap":\s*(\d+)/.exec(e.raw); if (m) this.lapIdx.push([+m[1], e.t]); }
    }
    for (const [lap, t] of this.lapIdx) if (lap >= n) return t;
    return null;
  }
  status() {
    return { active: true, ready: this.ready, loading: this.loading, error: this.error, progress: this.progress, meta: this.meta,
      start: this.start, end: this.end, pos: this.ready ? this.now() : null, speed: this.speed, playing: this.playing,
      started: this.ready ? this.started : null };
  }

  // ---- the message processor ----
  resetCore() {
    this.core = createCore({ live: false, now: () => this.processed || 0 });
    for (const m of this.initial) this.core.apply(m.topic, m.data, null);
    this.idx = 0; this.processed = 0;
  }
  advance(until) {
    if (until < this.processed) this.resetCore();
    const ev = this.events;
    while (this.idx < ev.length && ev[this.idx].t <= until) { const e = ev[this.idx++]; let data; try { data = JSON.parse(e.raw); } catch { continue; } this.core.apply(e.topic, data, new Date(e.t).toISOString()); }
    this.processed = until;
  }

  // ---- answering the dashboard ----
  handle(ep, q) {
    if (!/session_key=/.test(q)) return null;
    if (ep === 'sessions' && !/session_key=(latest|\d+)/.test(q)) return null;
    const now = this.now(); this.advance(now);
    const toShifted = r => { const o = { ...r }; if (o.date) { o.orig = o.date; o.date = new Date(this.out(Date.parse(o.date))).toISOString(); } if (o.date_start) o.date_start = new Date(this.out(Date.parse(o.date_start))).toISOString(); return o; };
    if (ep === 'sessions') {
      const b = this.core.sessionBase(); if (!b) return [];
      return [{ ...b, date_start: new Date(Date.now() - 3600e3).toISOString(), date_end: new Date(Date.now() + 3600e3).toISOString(), status: 'Started', replay: true }];
    }
    if (ep === 'pit_lane') return pitlane.result(this.circuitKey, this.year || this.meta.year);
    // dashboard times -> recording times
    let lo = -Infinity, hi = now, q2 = q;
    q2 = q2.replace(/(date|date_start)(>=|<=|>|<)([^&]+)/g, (m, f, op, v) => { const t = this.inn(Date.parse(v)); if (op[0] === '>') lo = Math.max(lo, t); else hi = Math.min(hi, t); return `${f}${op}${new Date(t).toISOString()}`; });
    const dn = (q.match(/driver_number=(\d+)/) || [])[1];
    if (ep === 'location' || ep === 'car_data') {
      const A = ep === 'location' ? this.loc : this.car; if (!A) return [];
      let i = lowerBound(A.t, lo === -Infinity ? this.start : lo + 1e-3), j = lowerBound(A.t, hi + 1e-3);
      const total = j - i, step = Math.max(1, Math.ceil(total / 40000)), out = [];
      for (let k = i; k < j; k += step) {
        if (dn && String(A.d[k]) !== dn) continue;
        const date = new Date(this.out(A.t[k])).toISOString();
        out.push(ep === 'location' ? { driver_number: A.d[k], date, x: A.x[k], y: A.y[k], z: A.z[k] }
          : { driver_number: A.d[k], date, rpm: A.rpm[k], speed: A.speed[k], n_gear: A.gear[k], throttle: A.thr[k], brake: A.brk[k], drs: A.drs[k] });
      }
      return out;
    }
    const rows = this.core.rows(ep); if (!rows) return null;
    return filterRows(rows, q2).filter(r => { const f = r.date || r.date_start; return !f || Date.parse(f) <= now; }).map(toShifted);
  }
}
function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }

let current = null;
let trimmed = false;
function start(token, meta) {
  if (!trimmed) { trimmed = true; cacheTrim(); }
  if (current) current.ac.abort();
  current = new Replay(token, meta);
  const r = current;
  r.load().catch(e => { r.error = e.message || String(e); r.loading = false; console.log('replay failed:', r.error); });
  return r;
}
module.exports = { index, start, stop: () => { if (current) current.ac.abort(); current = null; }, get current() { return current; } };
