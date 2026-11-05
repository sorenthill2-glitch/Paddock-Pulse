const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', { isDesktop: true });
contextBridge.exposeInMainWorld('desktopTheme', v => ipcRenderer.send('pp-theme', v)); // lets the window and F1 TV follow the chosen theme
contextBridge.exposeInMainWorld('desktopZoom', v => ipcRenderer.send('pp-zoom', v));   // interface size from the settings window
