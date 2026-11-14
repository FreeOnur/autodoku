// AutoDoku – Desktop-App (Electron)
// - kleiner lokaler Server (feste Adresse -> Daten bleiben erhalten), Mikrofon erlaubt
// - lokale Spracherkennung mit whisper.cpp (large-v3-turbo), siehe localstt.js
// - Ollama (lokale KI) installieren/starten/beenden, siehe ollama.js
// - Updates von GitHub Releases, siehe updater.js
// - Notizordner („Vault“) wie in Obsidian: Dateien lesen/schreiben/umbenennen/Papierkorb,
//   Ordner beobachten, Medien (PDF, Video, Bilder) per /vault/… streamen
// - Mini-Fenster (immer im Vordergrund), globale Tastenkürzel, Symbol im Infobereich
// - Handy-Verbindung: HTTPS im WLAN (selbst signiert) für Tafel-Kamera & Mikrofon vom Handy
const { app, BrowserWindow, session, shell, Menu, ipcMain, dialog, globalShortcut, Tray, nativeImage, Notification } = require('electron');
const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const LocalSTT = require('./localstt');
const Ollama = require('./ollama');
const Updater = require('./updater');

const ROOT = path.join(__dirname, '..');
const PORT = 47317;
const PHONE_PORT = 47318;
const OLLAMA = { host: '127.0.0.1', port: 11434 };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.gz': 'application/gzip',
};
const SKIP = new Set(['.git', 'node_modules', '.obsidian', '.trash', '.autodoku-cache']);

// ---------- Einstellungen ----------
const CFG_FILE = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() { try { return JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')); } catch (e) { return {}; } }
function saveCfg(c) { fs.mkdirSync(path.dirname(CFG_FILE()), { recursive: true }); fs.writeFileSync(CFG_FILE(), JSON.stringify(c, null, 2)); }
let cfg = {};
const vaultRoot = () => cfg.vault || '';

function inVault(rel) {
  const root = vaultRoot();
  if (!root) throw new Error('Kein Notizordner gewählt');
  const abs = path.resolve(root, String(rel || '').replace(/^[\\/]+/, ''));
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) throw new Error('Pfad außerhalb des Notizordners');
  return abs;
}
const toRel = (abs) => path.relative(vaultRoot(), abs).split(path.sep).join('/');

// ---------- Server ----------
function sendFile(req, res, file, extraHeaders) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Nicht gefunden'); }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const base = Object.assign({ 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' }, extraHeaders || {});
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] ? parseInt(range[1], 10) : 0;
      let end = range[2] ? parseInt(range[2], 10) : st.size - 1;
      if (!range[1] && range[2]) { start = st.size - parseInt(range[2], 10); end = st.size - 1; }
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, Object.assign(base, { 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 }));
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(base, { 'content-length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const ISOLATION = {
  // Cross-Origin-Isolation -> Whisper darf mehrere CPU-Kerne nutzen
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'credentialless',
  'cross-origin-resource-policy': 'same-origin',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/ollama/')) {
        const fwd = http.request({
          host: OLLAMA.host, port: OLLAMA.port, method: req.method, path: req.url.slice('/ollama'.length),
          headers: { 'content-type': req.headers['content-type'] || 'application/json' },
        }, (up) => {
          res.writeHead(up.statusCode, { 'content-type': up.headers['content-type'] || 'application/json', 'cache-control': 'no-cache' });
          up.pipe(res);
        });
        fwd.on('error', (err) => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'ollama offline: ' + err.message })); });
        req.pipe(fwd);
        res.on('close', () => { if (!res.writableFinished) fwd.destroy(); });
        return;
      }
      if (req.url.startsWith('/aiproxy')) return aiProxy(req, res);
      const fail = (e) => { if (!res.headersSent) res.writeHead(500); res.end(JSON.stringify({ error: e.message })); };
      if (req.url.startsWith('/stt/')) return LocalSTT.handle(req, res).catch(fail);
      if (req.url.startsWith('/ollamactl/')) return Ollama.handle(req, res).catch(fail);
      if (req.url.startsWith('/update/')) return Updater.handle(req, res).catch(fail);
      if (req.url.startsWith('/sys/ollama-quit')) {
        const on = new URL(req.url, 'http://x').searchParams.get('on');
        if (on != null) { cfg.stopOllamaOnQuit = on === '1'; saveCfg(cfg); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ on: cfg.stopOllamaOnQuit !== false }));
      }
      if (req.url.startsWith('/sys/info')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ version: app.getVersion(), ramGB: Math.round(os.totalmem() / 1024 ** 3), cores: os.cpus().length, nvidia: sysInfo.nvidia, platform: process.platform }));
      }
      if (req.url.startsWith('/vault/')) {
        let file;
        try { file = inVault(decodeURIComponent(req.url.slice(7).split('?')[0])); } catch (e) { res.writeHead(403); return res.end(); }
        return sendFile(req, res, file, ISOLATION);
      }
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT) || file.includes(`${path.sep}desktop${path.sep}`)) { res.writeHead(403); return res.end(); }
      sendFile(req, res, file, ISOLATION);
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// Eigene KI-API (OpenAI-kompatibel) ohne CORS-Probleme: Anfrage im Hauptprozess weiterreichen
async function aiProxy(req, res) {
  const target = req.headers['x-target-url'] || '';
  if (!/^https?:\/\//i.test(target)) { res.writeHead(400); return res.end('{"error":"x-target-url fehlt"}'); }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const ctl = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
  try {
    const headers = {};
    for (const h of ['authorization', 'content-type', 'accept', 'x-api-key', 'http-referer', 'x-title']) if (req.headers[h]) headers[h] = req.headers[h];
    if (/openrouter\.ai/.test(target)) { headers['http-referer'] = headers['http-referer'] || 'https://freeonur.github.io/autodoku/'; headers['x-title'] = 'AutoDoku'; }
    const up = await fetch(target, { method: req.method, headers, body: req.method === 'GET' ? undefined : Buffer.concat(chunks), signal: ctl.signal });
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json', 'cache-control': 'no-cache' });
    if (!up.body) return res.end();
    for await (const c of up.body) res.write(c);
    res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'nicht erreichbar: ' + e.message }));
  }
}

// ---------- Notizordner-API ----------
async function listAll(dirAbs, out, depth) {
  if (depth > 12 || out.length > 30000) return out;
  let entries;
  try { entries = await fsp.readdir(dirAbs, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.~')) continue;
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      out.push({ path: toRel(abs), name: e.name, type: 'dir' });
      await listAll(abs, out, depth + 1);
    } else if (e.isFile()) {
      let st = null; try { st = await fsp.stat(abs); } catch (x) { /* egal */ }
      out.push({ path: toRel(abs), name: e.name, type: 'file', size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 });
    }
  }
  return out;
}

let watcher = null, watchTimer = null, watchChanged = new Set();
function startWatch() {
  try { watcher && watcher.close(); } catch (e) { /* egal */ }
  watcher = null;
  if (!vaultRoot() || !fs.existsSync(vaultRoot())) return;
  try {
    watcher = fs.watch(vaultRoot(), { recursive: true }, (ev, name) => {
      if (!name) return;
      const rel = String(name).split(path.sep).join('/');
      if (rel.split('/').some(s => SKIP.has(s))) return;
      watchChanged.add(rel);
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        const list = [...watchChanged]; watchChanged.clear();
        if (win && !win.isDestroyed()) win.webContents.send('vault:changed', list);
      }, 350);
    });
  } catch (e) { /* recursive watch nicht verfügbar */ }
}

function registerIpc() {
  ipcMain.handle('vault:get', () => ({ vault: vaultRoot(), name: vaultRoot() ? path.basename(vaultRoot()) : '' }));
  ipcMain.handle('vault:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Notizordner wählen', properties: ['openDirectory', 'createDirectory'], defaultPath: vaultRoot() || app.getPath('documents') });
    if (r.canceled || !r.filePaths[0]) return null;
    cfg.vault = r.filePaths[0]; saveCfg(cfg); startWatch();
    return { vault: cfg.vault, name: path.basename(cfg.vault) };
  });
  ipcMain.handle('vault:useDefault', async () => {
    const def = path.join(app.getPath('documents'), 'AutoDoku Notizen');
    await fsp.mkdir(def, { recursive: true });
    cfg.vault = def; saveCfg(cfg); startWatch();
    return { vault: cfg.vault, name: path.basename(cfg.vault) };
  });
  ipcMain.handle('vault:list', async () => (vaultRoot() ? listAll(vaultRoot(), [], 0) : []));
  ipcMain.handle('vault:read', async (e, rel, enc) => {
    const buf = await fsp.readFile(inVault(rel));
    return enc === 'binary' ? new Uint8Array(buf) : buf.toString('utf8');
  });
  ipcMain.handle('vault:write', async (e, rel, data) => {
    const abs = inVault(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, typeof data === 'string' ? data : Buffer.from(data));
    return toRel(abs);
  });
  ipcMain.handle('vault:exists', async (e, rel) => { try { await fsp.access(inVault(rel)); return true; } catch (x) { return false; } });
  ipcMain.handle('vault:stat', async (e, rel) => { const st = await fsp.stat(inVault(rel)); return { size: st.size, mtime: st.mtimeMs, dir: st.isDirectory() }; });
  ipcMain.handle('vault:mkdir', async (e, rel) => { await fsp.mkdir(inVault(rel), { recursive: true }); return rel; });
  ipcMain.handle('vault:rename', async (e, from, to) => {
    const a = inVault(from), b = inVault(to);
    if (fs.existsSync(b)) throw new Error('Gibt es schon: ' + to);
    await fsp.mkdir(path.dirname(b), { recursive: true });
    await fsp.rename(a, b);
    return toRel(b);
  });
  ipcMain.handle('vault:trash', async (e, rel) => { await shell.trashItem(inVault(rel)); return true; });
  ipcMain.handle('vault:import', async (e, absList, destRel) => {
    // Dateien von außen (Drag & Drop) in den Notizordner kopieren
    const out = [];
    for (const src of absList || []) {
      if (!src || !fs.existsSync(src)) continue;
      let target = inVault(path.posix.join(destRel || '', path.basename(src)));
      const ext = path.extname(target), base = target.slice(0, target.length - ext.length);
      let i = 2; while (fs.existsSync(target)) target = `${base} (${i++})${ext}`;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const st = await fsp.stat(src);
      if (st.isDirectory()) await fsp.cp(src, target, { recursive: true }); else await fsp.copyFile(src, target);
      out.push(toRel(target));
    }
    return out;
  });
  ipcMain.handle('vault:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Dateien importieren', properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('vault:openExternal', async (e, rel) => shell.openPath(inVault(rel)));
  ipcMain.handle('vault:showInFolder', async (e, rel) => { shell.showItemInFolder(inVault(rel)); return true; });
  ipcMain.handle('app:openPath', async (e, abs) => shell.openPath(abs));
}

// ---------- Handy-Verbindung (Tafel-Kamera & Mikrofon) ----------
let phoneServer = null;
const phoneState = { recording: false, subject: '', title: '', ms: 0, subjects: [], lessonOpen: false };
function localIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}
function phoneCert() {
  const dir = app.getPath('userData');
  const kf = path.join(dir, 'phone-key.pem'), cf = path.join(dir, 'phone-cert.pem'), mf = path.join(dir, 'phone-cert.json');
  const ips = localIPs();
  try {
    const meta = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if (ips.every(ip => meta.ips.includes(ip)) && meta.until > Date.now() + 30 * 864e5) return { key: fs.readFileSync(kf), cert: fs.readFileSync(cf) };
  } catch (e) { /* neu erzeugen */ }
  const forge = require('./vendor/node-forge');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  const until = Date.now() + 2 * 365 * 864e5;
  cert.validity.notBefore = new Date(Date.now() - 864e5); cert.validity.notAfter = new Date(until);
  const attrs = [{ name: 'commonName', value: 'AutoDoku ' + os.hostname() }, { name: 'organizationName', value: 'AutoDoku' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }].concat(ips.map(ip => ({ type: 7, ip }))) }]);
  cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  fs.writeFileSync(kf, privateKey); fs.writeFileSync(cf, pem); fs.writeFileSync(mf, JSON.stringify({ ips, until }));
  return { key: privateKey, cert: pem };
}
function phoneToken() {
  if (!cfg.phoneToken) { cfg.phoneToken = crypto.randomBytes(9).toString('base64url'); saveCfg(cfg); }
  return cfg.phoneToken;
}
function phoneUrls() { const t = phoneToken(); return localIPs().map(ip => `https://${ip}:${PHONE_PORT}/phone/#${t}`); }

const MAX_UPLOAD = 60 * 1024 * 1024;
async function readBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_UPLOAD) throw new Error('zu groß'); chunks.push(c); }
  return Buffer.concat(chunks);
}
function startPhoneServer() {
  if (phoneServer) return Promise.resolve(true);
  return new Promise((resolve) => {
    let creds;
    try { creds = phoneCert(); } catch (e) { return resolve('Zertifikat: ' + e.message); }
    const srv = https.createServer(creds, async (req, res) => {
      const u = new URL(req.url, 'https://x');
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
      if (u.pathname === '/' ) { res.writeHead(302, { location: '/phone/' }); return res.end(); }
      if (u.pathname.startsWith('/phone/')) {
        let p = u.pathname.slice('/phone/'.length) || 'index.html';
        const file = path.normalize(path.join(ROOT, 'phone', p));
        if (!file.startsWith(path.join(ROOT, 'phone'))) { res.writeHead(403); return res.end(); }
        return sendFile(req, res, file);
      }
      if (u.pathname.startsWith('/vendor/')) {
        const file = path.normalize(path.join(ROOT, u.pathname));
        if (!file.startsWith(path.join(ROOT, 'vendor'))) { res.writeHead(403); return res.end(); }
        return sendFile(req, res, file);
      }
      if (!u.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
      const tok = req.headers['x-autodoku-token'] || u.searchParams.get('t');
      if (!tok || tok !== cfg.phoneToken) return json(401, { error: 'Falscher Code – QR-Code am Laptop neu scannen.' });
      try {
        if (u.pathname === '/api/ping') return json(200, Object.assign({ ok: true, name: os.hostname() }, phoneState));
        if (!win || win.isDestroyed()) return json(503, { error: 'AutoDoku-Fenster nicht offen' });
        if (u.pathname === '/api/photo' && req.method === 'POST') {
          const body = await readBody(req);
          win.webContents.send('phone:photo', { bytes: new Uint8Array(body), ts: +u.searchParams.get('ts') || Date.now(), auto: u.searchParams.get('auto') === '1', mime: req.headers['content-type'] || 'image/jpeg' });
          return json(200, { ok: true });
        }
        if (u.pathname === '/api/audio' && req.method === 'POST') {
          const body = await readBody(req);
          win.webContents.send('phone:audio', { bytes: new Uint8Array(body), rec: u.searchParams.get('rec'), seq: +u.searchParams.get('seq') || 0, start: +u.searchParams.get('start') || Date.now(), subject: u.searchParams.get('subject') || '', mime: req.headers['content-type'] || '', last: u.searchParams.get('last') === '1' });
          return json(200, { ok: true });
        }
        if (u.pathname === '/api/cmd' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
          win.webContents.send('phone:cmd', body);
          return json(200, { ok: true });
        }
        json(404, { error: 'unbekannt' });
      } catch (e) { json(500, { error: e.message }); }
    });
    srv.on('error', (e) => resolve('Server: ' + e.message));
    srv.listen(PHONE_PORT, '0.0.0.0', () => { phoneServer = srv; resolve(true); });
  });
}

// ---------- Mini-Fenster, Infobereich, Tastenkürzel ----------
let mini = null, tray = null, quitting = false;
const recState = { recording: false, ms: 0, subject: '', title: '' };
const icon = (name) => {
  const im = nativeImage.createFromPath(path.join(ROOT, 'icons', name + '-16.png'));
  try { im.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(ROOT, 'icons', name + '-32.png')) }); } catch (e) { /* egal */ }
  return im;
};
function sendApp(cmd, data) { if (win && !win.isDestroyed()) win.webContents.send('app:cmd', Object.assign({ cmd }, data || {})); }
function showMain() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function toggleMain() { if (!win) return; if (win.isVisible() && win.isFocused()) win.hide(); else showMain(); updateTray(); }
function openMini(focusNote) {
  if (mini && !mini.isDestroyed()) { mini.showInactive(); if (focusNote) { mini.focus(); mini.webContents.send('mini:focusNote'); } return; }
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workArea;
  mini = new BrowserWindow({
    width: 330, height: 74, x: wa.x + wa.width - 350, y: wa.y + 20, frame: false, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, transparent: true, hasShadow: true, focusable: true, show: false, title: 'AutoDoku Mini',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  mini.setAlwaysOnTop(true, 'floating');
  mini.loadURL(`http://127.0.0.1:${PORT}/mini.html`);
  mini.once('ready-to-show', () => { mini.showInactive(); mini.webContents.send('rec:state', recState); if (focusNote) { mini.focus(); mini.webContents.send('mini:focusNote'); } });
  mini.on('closed', () => { mini = null; });
}
function toggleMini() { if (mini && !mini.isDestroyed() && mini.isVisible()) mini.close(); else openMini(); }
const fmt = (ms) => { const s = Math.floor((ms || 0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function updateTray() {
  if (!tray) return;
  tray.setImage(icon(recState.recording ? 'tray-rec' : 'tray'));
  tray.setToolTip(recState.recording ? `AutoDoku – Aufnahme läuft (${recState.subject}) ${fmt(recState.ms)}` : 'AutoDoku');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win && win.isVisible() ? 'Fenster ausblenden' : 'Fenster zeigen', accelerator: SHORTCUTS.window, click: toggleMain },
    { label: 'Mini-Fenster', accelerator: SHORTCUTS.mini, click: toggleMini },
    { label: recState.recording ? '⏸ Aufnahme pausieren' : '⏺ Aufnahme starten', accelerator: SHORTCUTS.rec, click: () => sendApp('toggleRec') },
    { label: '✍️ Schnellnotiz', accelerator: SHORTCUTS.note, click: () => openMini(true) },
    { type: 'separator' },
    { label: 'Beenden', click: () => { quitting = true; app.quit(); } },
  ]));
}
const SHORTCUTS = { window: 'CommandOrControl+Alt+A', rec: 'CommandOrControl+Alt+R', note: 'CommandOrControl+Alt+N', mini: 'CommandOrControl+Alt+K' };
const shortcutStatus = {};
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const map = { window: toggleMain, rec: () => sendApp('toggleRec'), note: () => openMini(true), mini: toggleMini };
  for (const [k, acc] of Object.entries(Object.assign({}, SHORTCUTS, cfg.shortcuts || {}))) {
    SHORTCUTS[k] = acc;
    try { shortcutStatus[k] = globalShortcut.register(acc, map[k]); } catch (e) { shortcutStatus[k] = false; }
  }
}

function registerDesktopIpc() {
  ipcMain.on('rec:state', (e, st) => {
    Object.assign(recState, st);
    Object.assign(phoneState, { recording: !!st.recording, subject: st.subject || '', title: st.title || '', ms: st.ms || 0, lessonOpen: !!st.lessonOpen, phoneRec: st.phoneRec || null });
    if (Array.isArray(st.subjects)) phoneState.subjects = st.subjects;
    if (mini && !mini.isDestroyed()) mini.webContents.send('rec:state', recState);
    updateTray();
  });
  ipcMain.on('mini:cmd', (e, c) => {
    if (c.cmd === 'show') showMain();
    else if (c.cmd === 'close') { if (mini) mini.close(); }
    else if (c.cmd === 'resize' && mini) mini.setSize(330, Math.max(60, Math.min(260, c.h | 0)));
    else sendApp(c.cmd, c);
  });
  ipcMain.handle('desktop:info', () => ({ shortcuts: SHORTCUTS, shortcutStatus, phone: { running: !!phoneServer, urls: phoneServer ? phoneUrls() : [], port: PHONE_PORT } }));
  ipcMain.handle('desktop:setShortcuts', (e, sc) => { cfg.shortcuts = sc; saveCfg(cfg); registerShortcuts(); updateTray(); return shortcutStatus; });
  ipcMain.handle('phone:start', async () => { const r = await startPhoneServer(); cfg.phone = r === true; saveCfg(cfg); return { ok: r === true, error: r === true ? '' : r, urls: r === true ? phoneUrls() : [] }; });
  ipcMain.handle('phone:stop', async () => { if (phoneServer) { phoneServer.close(); phoneServer = null; } cfg.phone = false; saveCfg(cfg); return true; });
  ipcMain.handle('phone:newToken', async () => { cfg.phoneToken = ''; phoneToken(); return phoneUrls(); });
  ipcMain.on('mini:open', (e, note) => openMini(note));
  ipcMain.on('app:notify', (e, n) => { try { new Notification({ title: n.title || 'AutoDoku', body: n.body || '', silent: true }).show(); } catch (x) { /* egal */ } });
}

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const sysInfo = { nvidia: false };
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  app.setAppUserModelId('AutoDoku');
  Menu.setApplicationMenu(null);
  cfg = loadCfg();
  try {
    const gpu = await app.getGPUInfo('basic');
    sysInfo.nvidia = (gpu.gpuDevice || []).some(d => d.vendorId === 0x10de);
  } catch (e) { /* egal */ }
  LocalSTT.init(app.getPath('userData'));
  Ollama.init(app.getPath('userData'), sysInfo.nvidia);
  registerIpc();
  registerDesktopIpc();
  try { await startServer(); } catch (e) { /* läuft evtl. schon */ }
  startWatch();

  const ses = session.defaultSession;
  const allowed = ['media', 'microphone', 'audioCapture', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'notifications', 'speaker-selection'];
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.includes(permission)));
  ses.setPermissionCheckHandler((wc, permission) => allowed.includes(permission));

  // Fallback für Downloads: in den Notizordner (oder Dokumente\AutoDoku) speichern und öffnen
  ses.on('will-download', (event, item) => {
    const dir = vaultRoot() ? path.join(vaultRoot(), 'Word') : path.join(app.getPath('documents'), 'AutoDoku');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* egal */ }
    let target = path.join(dir, item.getFilename());
    const ext = path.extname(target), base = target.slice(0, -ext.length);
    let i = 2; while (fs.existsSync(target)) target = `${base} (${i++})${ext}`;
    item.setSavePath(target);
    item.once('done', (e, state) => { if (state === 'completed' && /\.docx$/i.test(target)) shell.openPath(target); });
  });

  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 420, minHeight: 500,
    title: 'AutoDoku', backgroundColor: '#0A110F', autoHideMenuBar: true,
    icon: path.join(ROOT, 'icons', 'autodoku.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${PORT}`)) { e.preventDefault(); shell.openExternal(url); } });
  win.loadURL(`http://127.0.0.1:${PORT}/`);
  // Schließen während einer Aufnahme -> in den Infobereich (Aufnahme läuft weiter, rotes Symbol bleibt)
  win.on('close', (e) => {
    if (!quitting && recState.recording) {
      e.preventDefault(); win.hide(); updateTray();
      try { new Notification({ title: 'AutoDoku nimmt weiter auf', body: 'Rotes Symbol unten rechts → Fenster zeigen oder beenden.', silent: true }).show(); } catch (x) { /* egal */ }
    }
  });
  win.on('show', updateTray); win.on('hide', updateTray);
  try { tray = new Tray(icon('tray')); tray.on('click', toggleMain); updateTray(); } catch (e) { tray = null; }
  registerShortcuts();
  if (cfg.phone) startPhoneServer();
});

app.on('before-quit', () => { quitting = true; });
// Beim Beenden aufräumen: Spracherkennung und Ollama aus, damit nichts im Hintergrund weiterläuft
let cleanedUp = false;
app.on('will-quit', (e) => {
  try { globalShortcut.unregisterAll(); } catch (x) { /* egal */ }
  LocalSTT.stop();
  if (cleanedUp) return;
  e.preventDefault();
  cleanedUp = true;
  const stopExternal = cfg && cfg.stopOllamaOnQuit !== false;
  Promise.race([Ollama.shutdown(stopExternal), new Promise(r => setTimeout(r, 4000))]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
