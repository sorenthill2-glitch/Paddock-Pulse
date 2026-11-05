// Paddock Pulse desktop shell. Starts the local server, shows the dashboard, and hosts F1 TV in
// <webview> boxes (the normal F1 TV player, signed in with your own account, kept between runs).
// Playing F1 TV video needs Electron with Widevine (castLabs "electron-releases"); plain Electron cannot.
const path = require('path');
const electron = require('electron');
const { app, BrowserWindow, session, shell, ipcMain, nativeTheme } = electron;
// a window behind another one (alt-tab) must keep running: otherwise Chromium treats it as hidden, pauses the video and throttles
// the page's timers while the replay clock keeps going, and video and data drift apart
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const PORT = process.env.PORT || '8765';
process.env.PORT = PORT;
if (app.isPackaged) process.env.PP_DATA_DIR = app.getPath('userData');   // installed: keep the login and saved circuits in the user's own folder
// only one copy at a time: a second launch just brings the first window forward
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
const { ready } = require('./server.js');

// interface size: 'auto' fits the window (a 2560x1440 screen at 225% scaling is only ~1140 CSS px wide), or a fixed factor
let mainWin = null, zoomSetting = 'auto';
function applyZoom() {
  if (!mainWin || mainWin.isDestroyed()) return;
  let f = zoomSetting;
  if (f === 'auto') {
    if (mainWin.isMinimized()) return;                      // a minimized window reports a tiny size: keep the current zoom
    const w = mainWin.getContentSize()[0];
    if (w < 400) return;
    f = Math.max(0.6, Math.min(1, w / 1500));
  }
  mainWin.webContents.setZoomFactor(f);
}
ipcMain.on('pp-zoom', (_e, v) => { zoomSetting = v === 'auto' ? 'auto' : Math.max(0.5, Math.min(2, +v || 1)); applyZoom(); });
ipcMain.on('pp-theme', (_e, v) => { nativeTheme.themeSource = v === 'light' || v === 'dark' ? v : 'system'; });

app.whenReady().then(async () => {
  const ua = app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ paddock-pulse\/\S+/, '');
  const f1ses = session.fromPartition('persist:f1tv');
  f1ses.setUserAgent(ua);
  const f1 = require('./f1feed');
  require('./f1login').watch(f1ses, { getCurrent: () => f1.readToken(), onToken: t => f1.saveToken(t), log: console.log });   // sign in inside the F1 TV box and the app has your login
  const win = new BrowserWindow({
    width: 1560, height: 960, backgroundColor: '#b9b9b2', title: 'Paddock Pulse', icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: { webviewTag: true, contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  mainWin = win; for (const ev of ['resize', 'restore', 'maximize', 'unmaximize']) win.on(ev, () => { if (zoomSetting === 'auto') applyZoom(); });
  // the window is already up; the page loads once the server is listening and Widevine is ready (capped at 20 s, so a stuck component
  // download can never keep the window blank)
  const widevine = (electron.components && electron.components.whenReady)
    ? Promise.race([electron.components.whenReady().then(() => console.log('Widevine components:', JSON.stringify(electron.components.status()))), new Promise(r => setTimeout(r, 20000))]).catch(e => console.warn('Widevine component not ready:', e.message || e))
    : Promise.resolve();
  const [port] = await Promise.all([ready, widevine]);
  win.loadURL('http://127.0.0.1:' + port + '/');
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
});
app.on('window-all-closed', () => app.quit());
