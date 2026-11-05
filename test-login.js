// Run with: npx electron test-login.js
// Checks that signing in inside the F1 TV box (a login-session cookie) is picked up on its own.
const { app, session } = require('electron');
process.env.PP_DATA_DIR = require('path').join(require('os').tmpdir(), 'pp-login-test');
const { watch } = require('./f1login');
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:f1tv-test-' + Date.now());
  let current = '', seen = [], fails = 0;
  const ok = (c, n) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + n); };
  watch(ses, { getCurrent: () => current, onToken: t => { current = t; seen.push(t); } });
  const setCookie = (tok, name = 'login-session') => ses.cookies.set({ url: 'https://f1tv.formula1.com', domain: '.formula1.com', name, value: encodeURIComponent(JSON.stringify({ data: { subscriptionToken: tok } })), secure: true, httpOnly: true });
  await sleep(300); ok(seen.length === 0, 'nothing happens before anyone signs in');
  await setCookie('eyJaaa.bbb.ccc', 'some-other-cookie'); await sleep(1500); ok(seen.length === 0, 'other cookies are ignored');
  await setCookie('eyJaaa.bbb.ccc'); await sleep(1800); ok(seen[0] === 'eyJaaa.bbb.ccc', 'signing in is picked up (httpOnly cookie, secure, different domain)');
  await setCookie('eyJaaa.bbb.ccc'); await sleep(1500); ok(seen.length === 1, 'the same login is not handled twice');
  await setCookie('eyJnew.token.value'); await sleep(1800); ok(seen[1] === 'eyJnew.token.value', 'a refreshed login replaces the old one');
  await ses.cookies.remove('https://f1tv.formula1.com', 'login-session'); await sleep(1200); ok(seen.length === 2, 'signing out does not break anything');
  console.log(fails ? fails + ' FAILED' : 'all ok'); app.exit(fails ? 1 : 0);
});
