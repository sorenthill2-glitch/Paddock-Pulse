// Turns F1 live-timing messages (topic + data + time) into OpenF1-shaped rows. Used for the live feed
// (f1feed.js) and for replays of recorded sessions (replay.js): both feed messages in, the dashboard cannot
// tell the difference.
const zlib = require('zlib');

const num = s => { const n = parseFloat(String(s).replace('+', '')); return isFinite(n) && /^[+-]?[\d.]+$/.test(String(s).trim()) ? n : null; };
function lapSecs(s) { if (!s) return null; const m = String(s).match(/^(?:(\d+):)?([\d.]+)$/); return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]) : null; }
const isoZ = u => { if (!u) return new Date().toISOString(); return /Z|[+-]\d\d:?\d\d$/.test(u) ? new Date(u).toISOString() : new Date(u + 'Z').toISOString(); };
function inflate(b64) { return JSON.parse(zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString('utf8')); }
function merge(t, p) {
  if (p === null || typeof p !== 'object') return p;
  if (t === null || typeof t !== 'object') t = Array.isArray(p) ? [] : {};
  for (const k of Object.keys(p)) {
    if (k === '_kf' || k === '_deleted' || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;   // never let a message touch Object.prototype
    t[k] = merge(t[k], p[k]);
  }
  return t;
}

// date filters from an OpenF1-style query string: date>=..., date_start<... ; returns {lo, hi} in ms
function dateBounds(q) {
  let lo = -Infinity, hi = Infinity;
  for (const m of q.matchAll(/(date|date_start)(>=|<=|>|<)([^&]+)/g)) { const t = Date.parse(m[3]); if (m[2][0] === '>') lo = Math.max(lo, t); else hi = Math.min(hi, t); }
  return { lo, hi };
}
function filterRows(rows, q) {
  const dn = (q.match(/driver_number=(\d+)/) || [])[1], { lo, hi } = dateBounds(q);
  return rows.filter(r => (!dn || String(r.driver_number) === dn) && (() => { const f = r.date || r.date_start; if (!f || (lo === -Infinity && hi === Infinity)) return true; const t = Date.parse(f); return t > lo && t <= hi; })());
}

// opts: { live: bool (trim old rows by wall clock), now: () => ms }
function createCore(opts = {}) {
  const live = !!opts.live, nowMs = opts.now || (() => Date.now());
  const state = {};
  const buf = { location: [], car_data: [], intervals: [], position: [], race_control: [], team_radio: [], weather: [] };
  const lapRows = new Map(), pits = new Map();
  const hooks = { sessionInfo: null };

  const trim = (a, keepMs) => { const cut = nowMs() - keepMs; let i = 0; while (i < a.length && Date.parse(a[i].date) < cut) i++; if (i) a.splice(0, i); };
  const line = n => ((state.TimingData || {}).Lines || {})[n];
  const inPit = n => { const l = line(n); return !!(l && (l.InPit || l.PitOut)); };
  const isOut = n => { const l = line(n); return !!(l && (l.Retired || (l.Stopped && !l.InPit))); };

  function apply(topic, data, ts) {
    try {
      if (topic === 'CarData.z' || topic === 'Position.z') {
        const j = typeof data === 'string' ? inflate(data) : data;
        if (topic === 'CarData.z') for (const e of j.Entries || []) for (const [n, c] of Object.entries(e.Cars || {})) {
          const ch = c.Channels || {};
          buf.car_data.push({ driver_number: +n, date: isoZ(e.Utc), rpm: ch[0], speed: ch[2], n_gear: ch[3], throttle: ch[4], brake: ch[5], drs: ch[45] });
        }
        else for (const e of j.Position || []) for (const [n, c] of Object.entries(e.Entries || {})) {
          const row = { driver_number: +n, date: isoZ(e.Timestamp), x: c.X, y: c.Y, z: c.Z };
          if (inPit(n)) row.pit = true;
          buf.location.push(row);
        }
        trim(buf.car_data, 6 * 60e3); trim(buf.location, 6 * 60e3);
        return;
      }
      state[topic] = merge(state[topic], data);
      if (topic === 'SessionInfo' && hooks.sessionInfo) hooks.sessionInfo();
      const date = ts ? new Date(ts).toISOString() : new Date(nowMs()).toISOString();
      if (topic === 'TimingData') {
        for (const [n, patch] of Object.entries(data.Lines || {})) {
          const ln = state.TimingData.Lines[n], d = +n;
          if (patch.GapToLeader !== undefined || (patch.IntervalToPositionAhead && patch.IntervalToPositionAhead.Value !== undefined)) {
            const g = ln.GapToLeader, i = ln.IntervalToPositionAhead && ln.IntervalToPositionAhead.Value;
            buf.intervals.push({ driver_number: d, date, gap_to_leader: g ? (num(g) ?? String(g).replace(/^\+?(\d+)L$/, '+$1 LAP')) : null, interval: i ? (num(i) ?? String(i).replace(/^\+?(\d+)L$/, '+$1 LAP')) : null });
          }
          if (patch.Position !== undefined) buf.position.push({ driver_number: d, date, position: +patch.Position });
          if (patch.LastLapTime && patch.LastLapTime.Value) {
            const dur = lapSecs(patch.LastLapTime.Value), lnum = +ln.NumberOfLaps || 0;
            if (dur && lnum) lapRows.set(d + ':' + lnum, { driver_number: d, lap_number: lnum, lap_duration: dur, date_start: new Date(Date.parse(date) - dur * 1000).toISOString() });
          }
          if (patch.BestLapTime && patch.BestLapTime.Value) {
            const dur = lapSecs(patch.BestLapTime.Value), lnum = +patch.BestLapTime.Lap || +ln.NumberOfLaps || 1;
            if (dur && !lapRows.has(d + ':' + lnum)) lapRows.set(d + ':' + lnum, { driver_number: d, lap_number: lnum, lap_duration: dur, date_start: new Date(Date.parse(date) - dur * 1000).toISOString() });
          }
          if (patch.NumberOfPitStops !== undefined) pits.set(d, +patch.NumberOfPitStops || 0);
          if (patch.NumberOfLaps !== undefined && !lapRows.has(d + ':' + patch.NumberOfLaps) && patch.NumberOfLaps)
            lapRows.set(d + ':' + patch.NumberOfLaps, { driver_number: d, lap_number: +patch.NumberOfLaps, lap_duration: null, date_start: date });
        }
        trim(buf.intervals, 10 * 60e3); trim(buf.position, 60 * 60e3);
      } else if (topic === 'RaceControlMessages') {
        const m = data.Messages; const list = Array.isArray(m) ? m : Object.values(m || {});
        for (const r of list) if (r && r.Message) {
          const d = isoZ(r.Utc);
          if (!buf.race_control.some(x => x.date === d && x.message === r.Message))
            buf.race_control.push({ date: d, lap_number: r.Lap, category: r.Category, flag: r.Flag, scope: r.Scope, sector: r.Sector, message: r.Message });
        }
        buf.race_control.sort((a, b) => a.date < b.date ? -1 : 1);
      } else if (topic === 'TeamRadio') {
        const c = data.Captures; const list = Array.isArray(c) ? c : Object.values(c || {});
        const path = state.SessionInfo && state.SessionInfo.Path;
        for (const r of list) if (r && r.Path && path) {
          const d = isoZ(r.Utc);
          if (!buf.team_radio.some(x => x.date === d && x.driver_number === +r.RacingNumber))
            buf.team_radio.push({ date: d, driver_number: +r.RacingNumber, recording_url: '/f1audio/' + path + r.Path }); // served by our server, which holds the token
        }
        buf.team_radio.sort((a, b) => a.date < b.date ? -1 : 1);
      } else if (topic === 'WeatherData') {
        const w = state.WeatherData;
        buf.weather.push({ date, air_temperature: +w.AirTemp, track_temperature: +w.TrackTemp, wind_speed: +w.WindSpeed, rainfall: +w.Rainfall });
        trim(buf.weather, 30 * 60e3);
      }
    } catch (e) { /* a malformed message must never kill the feed */ }
  }

  function sessionBase() {
    const s = state.SessionInfo; if (!s || !s.Meeting) return null;
    const off = String(s.GmtOffset || '00:00:00'), sign = off.startsWith('-') ? -1 : 1, [h, m] = off.replace('-', '').split(':').map(Number), offMs = sign * (h * 60 + m) * 60000;
    const utc = v => new Date(Date.parse(v + 'Z') - offMs).toISOString();
    return { session_key: s.Key, session_name: s.Name, session_type: s.Type, date_start: utc(s.StartDate), date_end: utc(s.EndDate), meeting_key: s.Meeting.Key,
      meeting_name: s.Meeting.Name, circuit_key: s.Meeting.Circuit && s.Meeting.Circuit.Key,
      circuit_short_name: (s.Meeting.Circuit && s.Meeting.Circuit.ShortName) || s.Meeting.Location,
      country_name: s.Meeting.Country && s.Meeting.Country.Name, country_code: s.Meeting.Country && s.Meeting.Country.Code, location: s.Meeting.Location, year: +String(s.StartDate).slice(0, 4) };
  }
  function drivers() {
    return Object.values(state.DriverList || {}).filter(d => d && d.RacingNumber).map(d => ({ driver_number: +d.RacingNumber, name_acronym: d.Tla, full_name: d.FirstName ? `${d.FirstName} ${d.LastName}` : d.BroadcastName, first_name: d.FirstName, last_name: d.LastName, team_name: d.TeamName, team_colour: d.TeamColour, retired: isOut(d.RacingNumber) }));
  }
  function stints() {
    const out = [];
    for (const [n, l] of Object.entries((state.TimingAppData || {}).Lines || {})) {
      if (!l) continue;   // a driver line can arrive as null
      const st = Array.isArray(l.Stints) ? l.Stints : Object.values(l.Stints || {}); let start = 1;
      st.forEach((s, i) => { if (!s) return; const run = Math.max(0, (+s.TotalLaps || 0) - (+s.StartLaps || 0)); out.push({ driver_number: +n, stint_number: i + 1, compound: s.Compound, tyre_age_at_start: +s.StartLaps || 0, lap_start: start, lap_end: start + run }); start += run; });
    }
    return out;
  }
  function pitRows() { const o = []; for (const [n, c] of pits) for (let i = 1; i <= c; i++) o.push({ driver_number: n, pit_duration: null, date: new Date(nowMs()).toISOString(), lap_number: null }); return o; }

  // full (unfiltered) rows for an endpoint, or null if this core does not answer it
  function rows(ep) {
    switch (ep) {
      case 'drivers': return drivers();
      case 'stints': return stints();
      case 'pit': return pitRows();
      case 'laps': return [...lapRows.values()];
      case 'lap_count': return state.LapCount ? [{ current: +state.LapCount.CurrentLap, total: +state.LapCount.TotalLaps }] : [];
      default: return buf[ep] || null;
    }
  }
  return { state, buf, apply, rows, sessionBase, inPit, hooks };
}

module.exports = { createCore, filterRows, dateBounds, merge, inflate, isoZ };
