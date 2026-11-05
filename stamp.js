// F1's recordings start every line with the session clock: "HH:MM:SS.mmm", or "D.HH:MM:SS.mmm" once the clock passes 24 hours
// (e.g. the 2026 Mexico City race). Returns the time in ms and where the message body starts, or null.
const RE = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)\.(\d{1,3})\d*/;
function stamp(l) {
  const m = RE.exec(l); if (!m) return null;
  const ms = +m[5].padEnd(3, '0');
  return { ms: ((((+m[1] || 0) * 24 + +m[2]) * 60 + +m[3]) * 60 + +m[4]) * 1000 + ms, at: m[0].length };
}
const rest = l => { const s = stamp(l); return l.slice(s ? s.at : 12); };
module.exports = { stamp, rest };
