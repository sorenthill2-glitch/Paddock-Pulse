// Paddock Pulse server: serves the app and proxies OpenF1 so credentials never reach the browser.
// Run:  node server.js   (Node 18+, no dependencies)
//
// Env vars (all optional):
//   PORT            default 8080
//   OPENF1_BASE     default https://api.openf1.org  (point at a self-hosted OpenF1 instance if you run one)
//   OPENF1_TOKEN    a ready-made bearer token, or
//   OPENF1_USER / OPENF1_PASS   your OpenF1 account; the server fetches and refreshes the token itself
// Without credentials the proxy still works against the free historical API and live mode stays hidden.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8080;
const BASE = (process.env.OPENF1_BASE || 'https://api.openf1.org').replace(/\/$/, '');
const HAS_AUTH = !!(process.env.OPENF1_TOKEN || (process.env.OPENF1_USER && process.env.OPENF1_PASS));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

let token = process.env.OPENF1_TOKEN || null, tokenExp = token ? Infinity : 0;
async function getToken() {
  if (token && Date.now() < tokenExp) return token;
  if (!process.env.OPENF1_USER) return token;
  const r = await fetch(BASE + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: process.env.OPENF1_USER, password: process.env.OPENF1_PASS }),
  });
  if (!r.ok) throw new Error('OpenF1 token request failed: HTTP ' + r.status);
  const j = await r.json();
  token = j.access_token;
  tokenExp = Date.now() + ((+j.expires_in || 3600) - 60) * 1000;
  return token;
}

// Short cache so many viewers share one upstream call (the API is rate limited).
const cache = new Map();
async function upstream(p) {
  const hit = cache.get(p);
  if (hit && Date.now() - hit.t < 2000) return hit;
  const headers = {};
  const tk = await getToken();
  if (tk) headers.Authorization = 'Bearer ' + tk;
  const r = await fetch(BASE + p, { headers });
  const body = Buffer.from(await r.arrayBuffer());
  const out = { t: Date.now(), status: r.status, type: r.headers.get('content-type') || 'application/json', body };
  if (r.ok) cache.set(p, out);
  if (cache.size > 300) cache.clear();
  return out;
}

// ---- Test mode: MOCK_SESSION=<session_key> replays a finished session as if it were live right now ----
// (MOCK_FROM = seconds into the session to start from, default 1200.) Dev only; uses the free API.
const MOCK = process.env.MOCK_SESSION, MOCK_FROM = +(process.env.MOCK_FROM || 1200);
const WINDOWED = new Set(['location', 'car_data', 'intervals']);
const WHOLE = { laps: 'date_start', stints: null, pit: 'date', drivers: null, race_control: 'date', team_radio: 'date', weather: 'date', position: 'date' };
let mock = null; const mcache = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function mget(p) {
  if (mcache.has(p)) return mcache.get(p);
  for (let a = 0; a < 5; a++) {
    await sleep(450);
    const r = await fetch(BASE + p);
    if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
    const j = r.ok ? await r.json() : [];
    mcache.set(p, j); return j;
  }
  return [];
}
async function mockInit() {
  const m = (await (await fetch(`${BASE}/v1/sessions?session_key=${MOCK}`)).json())[0];
  const hs = Date.parse(m.date_start);
  mock = { meta: m, hs, delta: Date.now() - (hs + MOCK_FROM * 1000) };
  console.log(`MOCK: replaying ${m.year} ${m.country_name} ${m.session_name} as live, starting ${MOCK_FROM}s in`);
}
async function mockHandle(p, search) {
  const q = decodeURIComponent(search), ep = p.replace('/v1/', '');
  if (!mock) await mockInit();
  const { delta, hs, meta } = mock, histNow = Date.now() - delta;
  const sh = v => (v ? new Date(Date.parse(v) + delta).toISOString() : v);
  if (ep === 'sessions' && (/session_key=latest/.test(q) || q.includes('session_key=' + MOCK)))
    return [{ ...meta, date_start: sh(meta.date_start), date_end: new Date(Date.now() + 2 * 3600e3).toISOString() }];
  const field = WINDOWED.has(ep) ? 'date' : WHOLE[ep];
  const key = q.match(/session_key=(\w+)/)?.[1];
  if (!(ep in WHOLE) && !WINDOWED.has(ep) || !(key === MOCK || key === 'latest')) return null;
  const dn = q.match(/driver_number=(\d+)/)?.[1];
  let lo = -Infinity, hi = histNow;
  for (const m of q.matchAll(/(date|date_start)(>=|<=|>|<)([^&]+)/g)) {
    const t = Date.parse(m[3]) - delta;
    if (m[2][0] === '>') lo = Math.max(lo, t); else hi = Math.min(hi, t);
  }
  let rows = [];
  if (WINDOWED.has(ep)) {
    const W = 120000, from = Math.max(lo, hs), w0 = Math.floor((from - hs) / W), w1 = Math.floor((hi - hs) / W);
    for (let w = w0; w <= w1 && w - w0 < 6; w++) {
      const a = new Date(hs + w * W).toISOString(), b = new Date(hs + (w + 1) * W).toISOString();
      rows.push(...await mget(`/v1/${ep}?session_key=${MOCK}&date>=${encodeURIComponent(a)}&date<${encodeURIComponent(b)}`));
    }
  } else rows = await mget(`/v1/${ep}?session_key=${MOCK}`);
  rows = rows.filter(r => (!dn || String(r.driver_number) === dn) && (!field || (() => { const t = Date.parse(r[field]); return t > lo && t <= hi; })()));
  return rows.map(r => {
    const o = { ...r };
    if (o.date) o.date = sh(o.date);
    if (o.date_start) {
      if (ep === 'laps' && o.lap_duration && Date.parse(r.date_start) + o.lap_duration * 1000 > histNow) { o.lap_duration = null; o.duration_sector_1 = o.duration_sector_2 = o.duration_sector_3 = null; }
      o.date_start = sh(o.date_start);
    }
    return o;
  });
}

// Default live source when no OpenF1 login is given: F1's own live timing feed (unofficial, see f1feed.js).
const F1 = !MOCK && (process.env.F1_FEED === '1' || !HAS_AUTH) ? require('./f1feed') : null;
if (F1) F1.connect();

process.on('unhandledRejection', e => console.error('unhandled rejection:', e && e.message || e));   // log it, never take the app down
process.on('uncaughtException', e => console.error('uncaught exception:', e && e.message || e));
const PUBLIC_FILES = new Set(['/index.html', '/layout.js', '/assets/logo-mark-solid.svg']);
const RP = require('./replay');
const { readToken, saveToken, tokenExpired } = require('./f1feed');
let feedDownUntil = 0;   // while the live feed is down, do not make every request wait for it
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // only this app's own page may talk to the server: not another website open in your browser (also blocks DNS rebinding)
  const hostName = (req.headers.host || '').replace(/:\d+$/, '');
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(hostName)) { res.writeHead(403); return res.end('Forbidden'); }
  if (/^\/(replay|f1token|f1audio)/.test(url.pathname)) {
    const o = req.headers.origin, sf = req.headers['sec-fetch-site'];
    if ((o && o !== 'http://' + req.headers.host) || sf === 'cross-site') return json(res, { error: 'not allowed' }, 403);
  }
  try {
    // ---- replays of recorded sessions (F1's own recordings, read with the F1 TV token) ----
    // the in-app "F1 login" box: save a new token (only from this app's own page, never from another website)
    if (url.pathname === '/f1token' && req.method === 'POST') {
      const origin = req.headers.origin || '', host = req.headers.host || '';
      if (origin !== 'http://' + host) return json(res, { error: 'not allowed' }, 403);
      let body = ''; for await (const c of req) { body += c; if (body.length > 20000) return json(res, { error: 'too large' }, 413); }
      const ok = saveToken(body);
      return json(res, ok ? { ok: true } : { error: 'No F1 login token found in that text. Paste the whole login-session cookie value.' }, ok ? 200 : 400);
    }
    if (url.pathname === '/replay/index') {
      try { return json(res, await RP.index(readToken(), +url.searchParams.get('year'))); }
      catch (e) {
        // a refusal for one year while the login is still valid just means F1 has no recordings for that year (2022 has none)
        const loginBad = !readToken() || tokenExpired();
        return json(res, { error: /^F1 refused/.test(e.message) && loginBad ? e.message : 'F1 has no recordings listed for ' + (+url.searchParams.get('year') || 'that year') }, 404);
      }
    }
    if (url.pathname === '/replay/load') {
      const p = url.searchParams.get('path'); if (!p || /\.\./.test(p)) return json(res, { error: 'bad path' }, 400);
      RP.start(readToken(), { path: p, year: +url.searchParams.get('year'), meeting: url.searchParams.get('meeting'), session: url.searchParams.get('session'), official: url.searchParams.get('official'), country: url.searchParams.get('country'), location: url.searchParams.get('location') });
      return json(res, RP.current.status());
    }
    if (url.pathname === '/replay/status') return json(res, RP.current ? RP.current.status() : { active: false });
    if (url.pathname === '/replay/lap') {
      const n = +url.searchParams.get('n'), c = RP.current;
      return json(res, { t: c && c.ready && Number.isInteger(n) && n >= 1 && n <= 200 ? c.lapStart(n) : null });
    }
    if (url.pathname === '/replay/control') {
      if (!RP.current || !RP.current.ready) return json(res, { active: !!RP.current });
      const q = url.searchParams, num = k => { const v = q.get(k); return v !== null && v !== '' && isFinite(+v) ? +v : null; };
      RP.current.control({ playing: q.has('playing') ? q.get('playing') === '1' : null, speed: num('speed'), pos: num('pos') });
      return json(res, RP.current.status());
    }
    if (url.pathname === '/replay/stop') { RP.stop(); return json(res, { active: false }); }
    if (RP.current && RP.current.ready && url.pathname.startsWith('/openf1/')) {
      const rows = RP.current.handle(url.pathname.replace(/^\/openf1\/v1\//, ''), decodeURIComponent(url.search));
      if (rows) return json(res, rows);
    }
    // team radio recordings live behind the F1 TV token, so we fetch them on the browser's behalf
    if (url.pathname.startsWith('/f1audio/')) {
      const rel = decodeURIComponent(url.pathname.slice('/f1audio/'.length));
      if (/\.\./.test(rel)) { res.writeHead(400); return res.end(); }
      const r = await fetch('https://livetiming.formula1.com/static/' + rel, { headers: { Authorization: 'Bearer ' + readToken() } });
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'max-age=86400' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (F1 && url.pathname.startsWith('/openf1/')) {
      if (Date.now() > feedDownUntil) { await F1.ready(10000); if (!F1.status().connected) feedDownUntil = Date.now() + 20000; }
      const rows = F1.handle(url.pathname.replace(/^\/openf1\/v1\//, ''), decodeURIComponent(url.search));
      if (rows) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(rows)); }
    }
    if (MOCK && url.pathname.startsWith('/openf1/')) {
      const rows = await mockHandle(url.pathname.slice('/openf1'.length), url.search);
      if (rows) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(rows)); }
    }
    if (url.pathname === '/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ proxy: true, live: HAS_AUTH || !!MOCK || !!F1, replay: true, f1feed: !!F1, token: !!readToken(), tokenBad: tokenExpired() }));
    }
    if (url.pathname.startsWith('/openf1/')) {
      const o = await upstream(url.pathname.slice('/openf1'.length) + url.search);
      res.writeHead(o.status, { 'Content-Type': o.type });
      return res.end(o.body);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(__dirname, path.normalize(rel));
    // only the page itself is public: never the token file, the server code, saved data or anything else in this folder
    const isFont = /^\/assets\/fonts\/[\w.-]+\.woff2$/.test(rel);
    if ((!PUBLIC_FILES.has(rel) && !isFont) || !file.startsWith(__dirname)) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});
// If the port is taken (another copy still running), use a free one instead of crashing.
// `ready` resolves with the port actually used, so the desktop window can open the right address.
const ready = new Promise(resolve => {
  const onListening = () => {
    const port = server.address().port;
    console.log(`Paddock Pulse on http://localhost:${port}  (live mode ${HAS_AUTH ? 'ON' : 'off, no OpenF1 credentials set'})`);
    resolve(port);
  };
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') { console.warn(`Port ${PORT} is in use, picking a free one`); server.listen(0, '127.0.0.1', onListening); }
    else throw e;
  });
  server.listen(PORT, '127.0.0.1', onListening);
});
module.exports = { ready };
