// Durability tests for the server. Run: node test-server.js
// Starts its own copy of the server on port 8099, then checks bad input, parallel load, replay loading, fast
// control changes, restarts and memory use. Needs f1-token.txt for the replay parts.
const { spawn } = require('child_process');
const PORT = 8099, B = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const failures = [];
const ok = (cond, name, extra = '') => { if (cond) pass++; else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); } console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra && !cond ? '  (' + extra + ')' : '')); };
const get = async (p, opt) => { const r = await fetch(B + p, opt); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { } return { status: r.status, text: t, json: j, type: r.headers.get('content-type') }; };
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const rss = () => new Promise(res => { const { execFile } = require('child_process'); execFile('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${srv.pid}).WorkingSet64`], (e, o) => res(e ? 0 : Math.round(+o / 1048576))); });

(async () => {
  await sleep(2500);
  console.log('\n== basics');
  let r = await get('/config'); ok(r.status === 200 && r.json && r.json.proxy === true, '/config answers', r.text.slice(0, 80));
  r = await get('/'); ok(r.status === 200 && /Paddock Pulse/.test(r.text), 'page is served');
  console.log('\n== files that must NOT be served');
  for (const f of ['/f1-token.txt', '/server.js', '/pitlane.js', '/package.json', '/data/pitlane2-65-2026.json', '/main.js', '/.gitignore', '/legacy/app-replay.html', '/node_modules/electron/package.json'])
    ok((await get(f)).status === 404, 'blocked ' + f);
  for (const f of ['/../f1-token.txt', '/%2e%2e/f1-token.txt', '/..%5cf1-token.txt', '/%2e%2e%2f%2e%2e%2fWindows/win.ini'])
    ok((await fetch(B + f, { redirect: 'manual' }).then(x => x.status).catch(() => 0)) !== 200, 'traversal refused ' + f);
  const tokenText = require('fs').existsSync('f1-token.txt') ? require('fs').readFileSync('f1-token.txt', 'utf8').trim().slice(-40) : null;
  console.log('\n== the token must not leak into any answer');
  let leaked = false;
  for (const p of ['/config', '/replay/status', '/replay/index?year=2025', '/openf1/v1/sessions?session_key=latest', '/openf1/v1/drivers?session_key=latest']) { const x = await get(p); if (tokenText && x.text.includes(tokenText)) leaked = true; }
  ok(!leaked, 'token never appears in responses');
  console.log('\n== bad input');
  r = await get('/replay/index?year=abc'); ok(r.status >= 400 && r.status < 500 && r.json, 'index with a non-number year', r.text.slice(0, 60));
  r = await get('/replay/index?year=1850'); ok(r.status >= 400 && r.status < 500, 'index for a year with no data');
  r = await get('/replay/index?year=2022'); ok(r.status >= 400 && r.status < 500 && r.json && r.json.error, '2022 (F1 lists none) gives a clear error', r.text.slice(0, 80));
  r = await get('/replay/index'); ok(r.status >= 400 && r.status < 500, 'index with no year');
  r = await get('/replay/load'); ok(r.status === 400, 'load with no path');
  r = await get('/replay/load?path=../../x'); ok(r.status === 400, 'load with ../ in the path');
  r = await get('/replay/load?path=' + encodeURIComponent('2025/..%2f..%2fx/')); ok(r.status === 400 || r.status === 200, 'load with encoded ../ does not crash', 'status ' + r.status);
  await get('/replay/stop');
  r = await get('/replay/control?playing=1&speed=4'); ok(r.status === 200 && r.json && r.json.active === false, 'control with no replay is harmless');
  r = await get('/f1audio/../server.js'); ok(r.status === 400 || r.status === 404, 'audio proxy refuses ../', 'status ' + r.status);
  r = await get('/f1audio/2025/nope.mp3'); ok(r.status >= 400, 'audio proxy: missing file is an error, not a crash', 'status ' + r.status);
  r = await get('/openf1/v1/' + 'x'.repeat(5000)); ok(r.status < 600, 'very long url handled');
  r = await get('/openf1/v1/location?session_key=latest&date>garbage'); ok(r.status < 500 || r.status === 502, 'bad date filter does not crash', 'status ' + r.status);
  console.log('\n== parallel load');
  const t0 = Date.now(); const many = await Promise.all(Array.from({ length: 80 }, (_, i) => get(['/config', '/openf1/v1/sessions?session_key=latest', '/openf1/v1/drivers?session_key=latest', '/replay/status'][i % 4])));
  ok(many.every(x => x.status === 200), '80 parallel requests all answered', many.filter(x => x.status !== 200).map(x => x.status).join(','));
  console.log('     took ' + (Date.now() - t0) + ' ms');
  const m0 = await rss(); console.log('     server memory now: ' + m0 + ' MB');

  if (!require('fs').existsSync('f1-token.txt')) { console.log('\n(no f1-token.txt: skipping replay tests)'); return end(); }
  console.log('\n== replays: different years and session types');
  const wantYears = [[2025, /Mexico/, 'Race'], [2025, /Mexico/, 'Qualifying'], [2025, /Mexico/, 'Practice 1'], [2024, /Mexico/, 'Race'], [2023, /Italian/, 'Race'], [2021, /Abu Dhabi/, 'Race'], [2020, /Bahrain/, 'Race'], [2019, /Monaco/, 'Race'], [2018, /Belgian/, 'Race']];
  const results = [];
  for (const [year, rx, sess] of wantYears) {
    const idx = await get('/replay/index?year=' + year); const m = idx.json && idx.json.find && idx.json.find(x => rx.test(x.name)); const s = m && m.sessions.find(x => x.name === sess);
    if (!s) { ok(false, `${year} ${rx} ${sess}: found in F1 index`); continue; }
    const t = Date.now(); await get(`/replay/load?path=${encodeURIComponent(s.path)}&year=${year}&meeting=${encodeURIComponent(m.name)}&session=${encodeURIComponent(sess)}`);
    let st; for (let i = 0; i < 120; i++) { await sleep(1000); st = (await get('/replay/status')).json; if (st.ready || st.error) break; }
    const secs = ((Date.now() - t) / 1000).toFixed(0);
    if (st.error) { console.log(`     ${year} ${m.name} ${sess}: not playable: ${st.error.slice(0, 90)}`); ok(true, `${year} ${m.name} ${sess}: fails with a readable message`); results.push([year, m.name, sess, 'error']); continue; }
    ok(st.ready, `${year} ${m.name} ${sess}: loads (${secs}s)`);
    const rows = {}; for (const ep of ['sessions', 'drivers', 'location', 'car_data', 'intervals', 'position', 'laps', 'stints', 'race_control', 'weather', 'lap_count', 'pit_lane']) { const x = await get(`/openf1/v1/${ep}?session_key=latest&date>${new Date(Date.now() - 20000).toISOString()}`); rows[ep] = x.json ? (Array.isArray(x.json) ? x.json.length : -1) : -1; if (x.status !== 200) ok(false, `${year} ${sess} ${ep} answers`, 'HTTP ' + x.status); }
    ok(rows.drivers >= 8 && rows.location > 0, `${year} ${sess}: drivers (${rows.drivers}) and car positions (${rows.location}) flow`);
    results.push([year, m.name, sess, 'ok ' + secs + 's', 'drivers ' + rows.drivers, 'loc ' + rows.location, 'car_data ' + rows.car_data, 'pit_lane ' + rows.pit_lane]);
  }
  console.log('\n== replay control abuse');
  const st0 = (await get('/replay/status')).json;
  if (st0.ready) {
    const calls = []; const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 400; i++) { const q = []; if (Math.random() < .6) q.push('pos=' + Math.round(rnd(st0.start - 1e6, st0.end + 1e6))); if (Math.random() < .5) q.push('speed=' + [0, -5, 0.01, 0.25, 1, 4, 32, 64, 1000, 'abc', ''][Math.floor(Math.random() * 11)]); if (Math.random() < .4) q.push('playing=' + (Math.random() < .5 ? 1 : 0)); calls.push(get('/replay/control?' + q.join('&'))); if (i % 7 === 0) calls.push(get('/openf1/v1/location?session_key=latest&date>' + new Date(Date.now() - 5000).toISOString())); if (i % 11 === 0) calls.push(get('/openf1/v1/race_control?session_key=latest')); }
    const out = await Promise.all(calls);
    ok(out.every(x => x.status === 200), `${calls.length} random control / data calls, no errors`, [...new Set(out.filter(x => x.status !== 200).map(x => x.status))].join(','));
    const st1 = (await get('/replay/status')).json;
    ok(isFinite(st1.pos) && st1.pos >= st1.start && st1.pos <= st1.end + 1, 'playhead stays inside the recording', `${st1.pos} not in ${st1.start}..${st1.end}`);
    ok(st1.speed >= 0.1 && st1.speed <= 64, 'speed stays in range', 'speed ' + st1.speed);
    await get('/replay/control?pos=' + (st0.end - 3000) + '&speed=8&playing=1'); await sleep(5000);
    const st2 = (await get('/replay/status')).json; ok(st2.pos <= st2.end, 'playing past the end stops at the end');
    const e = await get('/openf1/v1/location?session_key=latest&date>' + new Date(Date.now() - 5000).toISOString()); ok(e.status === 200, 'data still answers at the end of the recording');
  }
  console.log('\n== start, stop, restart cycles (memory)');
  const idx = await get('/replay/index?year=2025'), mex = idx.json.find(x => /Mexico/.test(x.name)), qual = mex.sessions.find(x => x.name === 'Qualifying');
  const mems = [];
  for (let i = 0; i < 5; i++) {
    await get(`/replay/load?path=${encodeURIComponent(qual.path)}&year=2025&meeting=x&session=Qualifying`);
    if (i === 2) { await sleep(300); await get('/replay/stop'); await get(`/replay/load?path=${encodeURIComponent(qual.path)}&year=2025&meeting=x&session=Qualifying`); } // stop in the middle of loading
    for (let k = 0; k < 90; k++) { await sleep(1000); const s = (await get('/replay/status')).json; if (s.ready || s.error || !s.active) break; }
    await get('/replay/control?pos=' + Math.round((await get('/replay/status')).json.start + 600000)); await get('/openf1/v1/laps?session_key=latest');
    await get('/replay/stop'); if (global.gc) global.gc(); mems.push(await rss());
  }
  console.log('     server memory after each load/stop cycle: ' + mems.join(', ') + ' MB');
  ok(Math.max(...mems) < 1800, 'memory stays reasonable', 'peak ' + Math.max(...mems) + ' MB');
  ok(mems[mems.length - 1] < mems[0] * 2.2 + 150, 'memory does not climb cycle after cycle', mems.join(','));
  console.log('\n== summary of replays tried'); for (const r of results) console.log('     ' + r.join(' | '));
  end();
  async function end() {
    await sleep(300); srv.kill();
    console.log(`\n${pass} checks passed, ${fail} failed`);
    if (fail) { console.log('\nFAILED:'); failures.forEach(f => console.log(' - ' + f)); }
    if (/Error|Unhandled|TypeError|ReferenceError/.test(log.replace(/Port \d+ is in use/g, ''))) console.log('\nSERVER LOG HAD ERRORS:\n' + log.split('\n').filter(l => /Error|Unhandled/.test(l)).slice(0, 10).join('\n'));
    process.exit(fail ? 1 : 0);
  }
  await end();
})().catch(e => { console.log('TEST CRASHED', e); srv.kill(); process.exit(2); });
