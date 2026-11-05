// Run: node test-feedcore.js   Checks the message processor against hostile or malformed input, and the clock-stamp parser.
const { createCore, merge } = require('./feedcore'), { stamp, rest } = require('./stamp');
let pass = 0, fail = 0; const t = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + n); };
merge({}, JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted2":1}}}'));
t('a message cannot pollute Object.prototype', ({}).polluted === undefined && ({}).polluted2 === undefined);
const c = createCore({ live: true });
const topics = ['TimingData', 'TimingAppData', 'RaceControlMessages', 'TeamRadio', 'WeatherData', 'SessionInfo', 'DriverList', 'LapCount', 'SessionStatus', 'CarData.z', 'Position.z', 'Nope'];
const junk = () => { const r = Math.random(); return r < .1 ? null : r < .2 ? 'x' : r < .3 ? [] : r < .4 ? { Lines: null } : r < .5 ? { Lines: { 1: null } } : r < .6 ? { Messages: 'oops' } : r < .7 ? { Captures: { a: 1 } } : r < .8 ? { Lines: { 1: { Position: 'abc', GapToLeader: {}, LastLapTime: { Value: '9:99:99' } } } } : { x: { y: { z: 1 } } }; };
let threw = 0; for (let i = 0; i < 20000; i++) { try { c.apply(topics[i % topics.length], junk(), Math.random() < .5 ? null : 'bad date'); } catch { threw++; } }
t('20000 malformed messages never throw', threw === 0);
let rowsOk = true; for (const ep of ['drivers', 'stints', 'pit', 'laps', 'lap_count', 'race_control', 'weather', 'nope']) { try { c.rows(ep); } catch { rowsOk = false; } }
t('rows() survives whatever state that left', rowsOk);
t('clock: HH:MM:SS.mmm', stamp('00:10:18.756{"a":1}').ms === 618756 && rest('00:10:18.756{"a":1}') === '{"a":1}');
t('clock: D.HH:MM:SS.mmm (past 24 h)', stamp('1.01:46:26.209{"b":2}').ms === 92786209 && rest('1.01:46:26.209{"b":2}') === '{"b":2}');
t('clock: junk gives null', stamp('') === null && stamp('hello') === null);
console.log(`\n${pass} ok, ${fail} failed`); process.exit(fail ? 1 : 0);
