// AutoDoku – Ollama verwalten (lokale KI), damit es den PC nicht dauerhaft belastet
// - Installiert Ollama ohne Autostart in den AutoDoku-Datenordner (nur ~40 MB statt 1,6 GB;
//   NVIDIA-Teil nur, wenn eine NVIDIA-Grafikkarte da ist)
// - Startet `ollama serve` erst, wenn die KI gebraucht wird: 1 Modell, 1 Anfrage gleichzeitig,
//   Modell nach 10 min Pause aus dem Speicher, niedrige Priorität
// - Beim Schließen von AutoDoku: Modelle entladen und Ollama beenden
//   (auch eine separat installierte Ollama-App, wenn „beim Beenden schließen“ an ist)
//   GET  /ollamactl/status   POST /ollamactl/start   POST /ollamactl/install   POST /ollamactl/autostart?off=1
const { spawn, execFile } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { extractRemote } = require('./remotezip');

const HOST = '127.0.0.1', PORT = 11434;
const isWin = process.platform === 'win32';
const EXE = isWin ? 'ollama.exe' : 'ollama';
const RELEASE_API = 'https://api.github.com/repos/ollama/ollama/releases/latest';

let userData = '', hasNvidia = false;
let child = null, starting = null;
const install = { state: 'idle', progress: 0, error: '', step: '' };

const managedDir = () => path.join(userData, 'ollama');
const systemExe = () => (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', EXE) : '');
const startupLnk = () => (process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Ollama.lnk') : '');
function findExe() {
  const m = path.join(managedDir(), EXE);
  if (fs.existsSync(m)) return { exe: m, managed: true };
  const s = systemExe();
  if (s && fs.existsSync(s)) return { exe: s, managed: false };
  return null;
}

function req(method, p, body, timeout = 2500) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: HOST, port: PORT, method, path: p, timeout, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
      let b = ''; res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* egal */ } resolve({ ok: res.statusCode < 400, json: j }); });
    });
    r.on('error', () => resolve({ ok: false })); r.on('timeout', () => { r.destroy(); resolve({ ok: false }); });
    r.end(data);
  });
}
const reachable = async () => (await req('GET', '/api/version')).ok;

async function start() {
  if (await reachable()) return true;
  if (starting) return starting;
  const f = findExe();
  if (!f) throw new Error('Ollama ist nicht installiert.');
  starting = (async () => {
    const env = Object.assign({}, process.env, {
      OLLAMA_HOST: `${HOST}:${PORT}`,
      OLLAMA_KEEP_ALIVE: '10m',          // Modell nach 10 min Pause entladen
      OLLAMA_MAX_LOADED_MODELS: '1',
      OLLAMA_NUM_PARALLEL: '1',          // weniger Arbeitsspeicher
      OLLAMA_FLASH_ATTENTION: '1',
      OLLAMA_KV_CACHE_TYPE: 'q8_0',      // halber Speicher für den Kontext
      OLLAMA_ORIGINS: 'http://127.0.0.1:*,http://localhost:*',
    });
    child = spawn(f.exe, ['serve'], { env, windowsHide: true, stdio: 'ignore', cwd: path.dirname(f.exe) });
    const me = child;
    child.on('exit', () => { if (child === me) child = null; });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* egal */ }
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (await reachable()) { starting = null; return true; }
      if (!child) break;
      await new Promise(r => setTimeout(r, 400));
    }
    starting = null;
    throw new Error('Ollama startet nicht.');
  })();
  return starting;
}

// Modelle aus dem Arbeitsspeicher werfen
async function unloadAll() {
  const ps = await req('GET', '/api/ps');
  const models = (ps.json && ps.json.models) || [];
  await Promise.all(models.map(m => req('POST', '/api/generate', { model: m.name, keep_alive: 0 }, 5000)));
  return models.length;
}

function killExternal() {
  if (!isWin) return Promise.resolve();
  return new Promise((resolve) => execFile('taskkill', ['/F', '/T', '/IM', 'ollama app.exe', '/IM', 'ollama.exe'], { windowsHide: true }, () => resolve()));
}

// Beim Beenden von AutoDoku
async function shutdown(stopExternal) {
  try { if (await reachable()) await unloadAll(); } catch (e) { /* egal */ }
  if (child) { try { child.kill(); } catch (e) { /* egal */ } child = null; }
  else if (stopExternal) await killExternal();
}

// ---------- Installieren (ohne Autostart, nur das Nötige) ----------
async function runInstall() {
  if (install.state === 'running') return;
  Object.assign(install, { state: 'running', progress: 0, error: '', step: 'Suche aktuelle Version' });
  try {
    if (!isWin) throw new Error('Automatische Installation gibt es nur unter Windows.');
    const rel = await (await fetch(RELEASE_API, { headers: { accept: 'application/vnd.github+json' } })).json();
    const asset = (rel.assets || []).find(a => a.name === 'ollama-windows-amd64.zip');
    if (!asset) throw new Error('Ollama-Download nicht gefunden.');
    install.step = hasNvidia ? `Lade Ollama ${rel.tag_name} (mit NVIDIA-Unterstützung)` : `Lade Ollama ${rel.tag_name}`;
    const dir = managedDir();
    await fsp.mkdir(dir, { recursive: true });
    const keep = (n) => !/(^|\/)(rocm|mlx)(\/|$)/i.test(n) && (!/cuda_v/i.test(n) || (hasNvidia && /cuda_v13/i.test(n)));
    await extractRemote(asset.browser_download_url, dir, keep, (p) => { install.progress = p; });
    Object.assign(install, { state: 'done', progress: 1, step: 'Fertig' });
  } catch (e) {
    Object.assign(install, { state: 'error', error: e.message });
  }
}

async function status() {
  const f = findExe();
  const up = await reachable();
  let models = [], loaded = [];
  if (up) {
    const t = await req('GET', '/api/tags'); models = ((t.json && t.json.models) || []).map(m => ({ name: m.name, size: m.size }));
    const ps = await req('GET', '/api/ps'); loaded = ((ps.json && ps.json.models) || []).map(m => m.name);
  }
  return {
    installed: !!f, managed: !!(f && f.managed), running: up, ours: !!child, models, loaded,
    autostart: !!(startupLnk() && fs.existsSync(startupLnk())), nvidia: hasNvidia, install,
  };
}

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); res.end(JSON.stringify(obj)); }
async function handle(req0, res) {
  const url = new URL(req0.url, 'http://x');
  try {
    if (url.pathname === '/ollamactl/status') return json(res, 200, await status());
    if (url.pathname === '/ollamactl/start' && req0.method === 'POST') { await start(); return json(res, 200, { ok: true }); }
    if (url.pathname === '/ollamactl/install' && req0.method === 'POST') { runInstall(); return json(res, 200, { ok: true }); }
    if (url.pathname === '/ollamactl/unload' && req0.method === 'POST') return json(res, 200, { unloaded: await unloadAll() });
    if (url.pathname === '/ollamactl/autostart' && req0.method === 'POST') {
      // Windows-Autostart der Ollama-App entfernen (AutoDoku startet Ollama selbst, wenn nötig)
      const lnk = startupLnk();
      if (lnk && fs.existsSync(lnk)) await fsp.rename(lnk, lnk + '.aus');
      return json(res, 200, { ok: true });
    }
  } catch (e) { return json(res, 500, { error: e.message }); }
  json(res, 404, { error: 'unbekannt' });
}

module.exports = { handle, start, shutdown, status, init(ud, nvidia) { userData = ud; hasNvidia = !!nvidia; } };
