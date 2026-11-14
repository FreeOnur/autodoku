// Brücke zwischen Oberfläche und Windows: Systeminfos + Notizordner-Zugriff
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const os = require('os');

contextBridge.exposeInMainWorld('AUTODOKU_INFO', {
  desktop: true,
  ramGB: Math.round(os.totalmem() / 1024 ** 3),
  cpus: os.cpus().length,
  platform: process.platform,
  version: (() => { try { return require('../package.json').version; } catch (e) { return ''; } })(),
});

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('vaultAPI', {
  get: () => inv('vault:get'),
  choose: () => inv('vault:choose'),
  useDefault: () => inv('vault:useDefault'),
  list: () => inv('vault:list'),
  read: (rel, enc) => inv('vault:read', rel, enc),
  write: (rel, data) => inv('vault:write', rel, data),
  exists: (rel) => inv('vault:exists', rel),
  stat: (rel) => inv('vault:stat', rel),
  mkdir: (rel) => inv('vault:mkdir', rel),
  rename: (a, b) => inv('vault:rename', a, b),
  trash: (rel) => inv('vault:trash', rel),
  import: (absList, dest) => inv('vault:import', absList, dest),
  pickFiles: () => inv('vault:pickFiles'),
  openExternal: (rel) => inv('vault:openExternal', rel),
  showInFolder: (rel) => inv('vault:showInFolder', rel),
  // Pfad einer per Drag & Drop gezogenen Datei
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return file && file.path; } },
  onChanged: (fn) => ipcRenderer.on('vault:changed', (e, list) => fn(list)),
});

// Desktop-Extras: Mini-Fenster, Tastenkürzel, Handy-Verbindung
contextBridge.exposeInMainWorld('desktopAPI', {
  info: () => inv('desktop:info'),
  setShortcuts: (sc) => inv('desktop:setShortcuts', sc),
  sendState: (st) => ipcRenderer.send('rec:state', st),
  onState: (fn) => ipcRenderer.on('rec:state', (e, st) => fn(st)),
  onCmd: (fn) => ipcRenderer.on('app:cmd', (e, c) => fn(c)),
  miniCmd: (c) => ipcRenderer.send('mini:cmd', c),
  openMini: (note) => ipcRenderer.send('mini:open', !!note),
  onFocusNote: (fn) => ipcRenderer.on('mini:focusNote', () => fn()),
  notify: (n) => ipcRenderer.send('app:notify', n),
  phoneStart: () => inv('phone:start'),
  phoneStop: () => inv('phone:stop'),
  phoneNewToken: () => inv('phone:newToken'),
  onPhone: (fn) => {
    ipcRenderer.on('phone:photo', (e, d) => fn('photo', d));
    ipcRenderer.on('phone:audio', (e, d) => fn('audio', d));
    ipcRenderer.on('phone:cmd', (e, d) => fn('cmd', d));
  },
});
