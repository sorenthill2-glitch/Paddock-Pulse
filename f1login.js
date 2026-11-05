// Picks the F1 login up by itself: the F1 TV box is a real browser session, so when someone signs in there F1 stores a
// "login-session" cookie. We read that cookie (in the app's main process, never from a web page) and hand the token on.
const { parseToken } = require('./f1feed');

// ses: an Electron session; getCurrent(): the token we already use; onToken(token): called with a new one
function watch(ses, { getCurrent, onToken, log }) {
  let busy = false;
  const grab = async () => {
    if (busy) return; busy = true;
    try {
      for (const c of await ses.cookies.get({ name: 'login-session' })) {
        let raw = c.value; try { raw = decodeURIComponent(raw); } catch { }
        const t = parseToken(raw);
        if (t && t !== getCurrent()) { onToken(t); if (log) log('F1 login picked up from the F1 TV box'); break; }
      }
    } catch (e) { /* no cookie yet, or the session is closing */ } finally { busy = false; }
  };
  // F1 refreshes the cookie now and then and sets it on sign-in: follow it
  ses.cookies.on('changed', (_e, cookie, _cause, removed) => { if (cookie.name === 'login-session' && !removed) setTimeout(grab, 600); });
  grab();
  return grab;
}
module.exports = { watch };
