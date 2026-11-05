// Unofficial adapter: reads F1's own live timing feed (the one the F1 website and FastF1 use)
// and answers OpenF1-shaped requests from it, so the dashboard works without an OpenF1 account.
// Unofficial and undocumented: F1 can change or block it at any time. Personal use.
const pitlane = require('./pitlane');
const { createCore, filterRows } = require('./feedcore');
const URL_NEG = 'https://livetiming.formula1.com/signalrcore/negotiate?negotiateVersion=1';
const URL_WS = 'wss://livetiming.formula1.com/signalrcore';
const RS = '\x1e';
const TOPICS = ['Heartbeat', 'CarData.z', 'Position.z', 'TrackStatus', 'DriverList', 'RaceControlMessages', 'SessionInfo', 'LapCount', 'TimingData', 'TimingAppData', 'TeamRadio', 'WeatherData', 'SessionStatus'];

const core = createCore({ live: true });
const state = core.state;
let connected = false, lastMsg = 0;

// Token: F1_TOKEN env var, or the file f1-token.txt next to this script. Either may hold the bare token
// or the whole `login-session` cookie value (URL-encoded JSON); the token is pulled out of it.
const dataDir = () => process.env.PP_DATA_DIR || __dirname;
const tokenFile = () => require('path').join(dataDir(), 'f1-token.txt');
function parseToken(raw) {
  raw = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return '';
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(raw)) return raw;
  try { const j = JSON.parse(decodeURIComponent(raw)); return (j.data && j.data.subscriptionToken) || j.subscriptionToken || ''; } catch { }
  const m = raw.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/); return m ? m[0] : '';
}
function readToken() {
  let raw = process.env.F1_TOKEN || '';
  if (!raw) { try { raw = require('fs').readFileSync(tokenFile(), 'utf8'); } catch { } }
  return parseToken(raw);
}
// the token is a JWT: its own expiry says whether F1 will still accept it
function tokenExpired() {
  const t = readToken(); if (!t) return false;
  try { const p = JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); return !!p.exp && p.exp * 1000 < Date.now(); } catch { return false; }
}
// saved from the app's "F1 login" box; the live connection is restarted so it picks the new token up
function saveToken(raw) {
  const t = parseToken(raw); if (!t) return false;
  const fs = require('fs'); fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(tokenFile(), t, { mode: 0o600 });
  pitlane.forget();
  try { if (ws) ws.close(); } catch { }
  return true;
}

let hb = null, retry = 1000, ws = null;
async function connect() {
  try {
    const TOKEN = readToken();
    const auth = TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {};
    const n = await fetch(URL_NEG, { method: 'POST', headers: auth });
    const nj = await n.json();
    const cookie = (n.headers.getSetCookie ? n.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    ws = new WebSocket(URL_WS + '?id=' + encodeURIComponent(nj.connectionToken || nj.connectionId) + (TOKEN ? '&access_token=' + encodeURIComponent(TOKEN) : ''), { headers: { ...auth, Cookie: cookie, 'User-Agent': 'BestHTTP', 'Accept-Encoding': 'gzip,identity' } });
    let first = true;
    ws.onopen = () => { retry = 1000; ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS); };
    ws.onmessage = e => {
      lastMsg = Date.now();
      for (const part of String(e.data).split(RS)) {
        if (!part) continue;
        let m; try { m = JSON.parse(part); } catch { continue; }
        if (first) { first = false; connected = true; ws.send(JSON.stringify({ arguments: [TOPICS], invocationId: '1', target: 'Subscribe', type: 1 }) + RS); }
        if (m.type === 3 && m.result) for (const [t, d] of Object.entries(m.result)) core.apply(t, d, null);
        else if (m.type === 1 && m.target === 'feed') core.apply(m.arguments[0], m.arguments[1], m.arguments[2]);
      }
    };
    clearInterval(hb); hb = setInterval(() => { try { ws.send(JSON.stringify({ type: 6 }) + RS); } catch { } }, 10000);
    ws.onclose = () => { connected = false; clearInterval(hb); setTimeout(connect, retry = Math.min(retry * 2, 30000)); };
    ws.onerror = () => { };
  } catch (e) { connected = false; setTimeout(connect, retry = Math.min(retry * 2, 30000)); }
}

// the recorded sessions of this circuit give us the real pit lane, pit boxes and circuit outline
function startPitLane() {
  const s = state.SessionInfo; if (!s || !s.Meeting || !s.Meeting.Circuit) return;
  const token = readToken(); if (!token) return;
  pitlane.ensure(token, s.Meeting.Circuit.Key, +String(s.StartDate).slice(0, 4),
    n => { const d = (state.DriverList || {})[n]; return d && d.TeamName ? { name: d.TeamName, color: '#' + (d.TeamColour || '888888') } : null; },
    (...m) => console.log(...m));
}
core.hooks.sessionInfo = startPitLane;

function sessionRow() {
  const r = core.sessionBase(); if (!r) return [];
  // The scheduled end is only a guess (red flags and delays overrun it). Trust the feed's own session status.
  const status = state.SessionStatus && state.SessionStatus.Status;
  let end = r.date_end;
  if ((status === 'Started' || status === 'Aborted') && Date.now() > Date.parse(end)) end = new Date(Date.now() + 30 * 60e3).toISOString();
  else if ((status === 'Finished' || status === 'Finalised' || status === 'Ends') && Date.parse(end) > Date.now()) end = new Date().toISOString();
  return [{ ...r, date_end: end, status }];
}

// Returns an array for requests this adapter answers, or null to let the server handle them otherwise.
function handle(ep, q) {
  const key = (q.match(/session_key=(\w+)/) || [])[1];
  const mine = key === 'latest' || (state.SessionInfo && String(state.SessionInfo.Key) === key);
  if (!mine || !connected) return null;
  let rows;
  if (ep === 'sessions') rows = sessionRow();
  else if (ep === 'pit_lane') { const c = state.SessionInfo && state.SessionInfo.Meeting && state.SessionInfo.Meeting.Circuit; rows = pitlane.result(c && c.Key, +String(state.SessionInfo.StartDate).slice(0, 4)); }
  else rows = core.rows(ep);
  if (!rows) return null;
  return filterRows(rows, q);
}
// Resolves once the feed has connected and delivered session info (or after timeoutMs).
function ready(timeoutMs) {
  return new Promise(res => {
    const t0 = Date.now();
    const tick = () => (connected && state.SessionInfo) || Date.now() - t0 > timeoutMs ? res() : setTimeout(tick, 150);
    tick();
  });
}
const status = () => ({ connected, lastMsgAgoMs: lastMsg ? Date.now() - lastMsg : null, session: state.SessionInfo && state.SessionInfo.Meeting && state.SessionInfo.Meeting.Name });

module.exports = { connect, handle, status, ready, readToken, saveToken, tokenFile, parseToken, tokenExpired };
