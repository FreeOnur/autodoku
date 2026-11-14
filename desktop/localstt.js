// AutoDoku – lokale Spracherkennung mit whisper.cpp (Whisper large-v3-turbo)
// Läuft als eigenes kleines Programm (whisper-server.exe) mit begrenzten CPU-Kernen und niedriger Priorität.
// Wird erst beim ersten Abschnitt gestartet und nach 10 Minuten ohne Arbeit beendet (gibt den Arbeitsspeicher frei).
//   GET  /stt/status     -> { installed, running, model, threads, install }
//   POST /stt/install    -> lädt Programm + Modell (einmalig, ca. 560 MB)
//   POST /stt/inference  -> multipart wie bei whisper.cpp (file, language, prompt …) -> { text }
const { spawn, execFile } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PORT = 47319;
const IDLE_MS = 10 * 60 * 1000;
const MODEL_FILE = 'ggml-large-v3-turbo-q5_0.bin';
const BIN_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip';
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/' + MODEL_FILE;
const EXE = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
// Leistung: wie viele Kerne whisper.cpp nutzen darf (weniger = leiser, aber langsamer)
const POWER = { leise: 2, normal: 4, schnell: 8 };

let userData = '';
let child = null, childThreads = 0, starting = null, idleTimer = null, busy = 0;
const install = { state: 'idle', progress: 0, error: '' };

// Im Datenordner (%APPDATA%\\AutoDoku\\whisper), damit Updates die 550 MB nicht löschen.
// Alte Installationen hatten es neben AutoDoku.exe – wird beim Start einmal verschoben.
const legacyDir = () => path.join(path.dirname(process.execPath), 'whisper');
function dirs() {
  const out = [];
  if (userData) out.push(path.join(userData, 'whisper'));
  out.push(legacyDir());
  return out;
}
async function migrate() {
  const from = legacyDir(), to = userData && path.join(userData, 'whisper');
  if (!to || !fs.existsSync(path.join(from, EXE)) || fs.existsSync(path.join(to, EXE))) return;
  try {
    await fsp.mkdir(to, { recursive: true });
    for (const f of await fsp.readdir(from)) if (f === EXE || /\.(dll|bin)$/i.test(f)) await fsp.rename(path.join(from, f), path.join(to, f));
  } catch (e) { /* bleibt einfach am alten Ort */ }
}
function find() {
  for (const d of dirs()) {
    const exe = path.join(d, EXE);
    if (!fs.existsSync(exe)) continue;
    let model = path.join(d, MODEL_FILE);
    if (!fs.existsSync(model)) {
      const any = (fs.readdirSync(d).filter(f => /^ggml-.*\.bin$/.test(f)).sort().reverse())[0];
      if (!any) continue;
      model = path.join(d, any);
    }
    return { dir: d, exe, model };
  }
  return null;
}
function threadsFor(power) {
  const n = os.cpus().length || 4;
  return Math.max(1, Math.min(POWER[power] || POWER.normal, n - 2));
}

function health() {
  return new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 1500 }, (res) => {
      let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve(res.statusCode === 200 && /ok/i.test(b)));
    });
    r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); });
  });
}

function stop() {
  clearTimeout(idleTimer);
  if (child) { try { child.kill(); } catch (e) { /* egal */ } }
  child = null; starting = null;
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!busy) stop(); else touch(); }, IDLE_MS);
}

async function ensure(power) {
  const want = threadsFor(power);
  if (child && childThreads !== want && !busy) stop();
  if (child && !starting) return true;
  if (starting) return starting;
  const f = find();
  if (!f) throw new Error('Lokale Spracherkennung ist noch nicht eingerichtet.');
  starting = (async () => {
    const args = ['-m', f.model, '--host', '127.0.0.1', '--port', String(PORT), '-t', String(want), '-l', 'de', '-nt', '-sns'];
    child = spawn(f.exe, args, { cwd: f.dir, windowsHide: true, stdio: 'ignore' });
    childThreads = want;
    const me = child;
    child.on('exit', () => { if (child === me) { child = null; starting = null; } });
    // niedrige Priorität: Windows und andere Programme bleiben flüssig
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* egal */ }
    const until = Date.now() + 90000; // Modell laden dauert ein paar Sekunden
    while (Date.now() < until) {
      if (!child || child !== me) throw new Error('whisper.cpp ist beim Start abgestürzt.');
      if (await health()) { starting = null; touch(); return true; }
      await new Promise(r => setTimeout(r, 400));
    }
    stop();
    throw new Error('whisper.cpp startet nicht (Zeitüberschreitung).');
  })();
  try { return await starting; } catch (e) { starting = null; throw e; }
}

function forward(body, contentType) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/inference',
      headers: { 'content-type': contentType, 'content-length': body.length } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(180000, () => r.destroy(new Error('Zeitüberschreitung')));
    r.end(body);
  });
}

// ---------- Einrichten (einmalig herunterladen) ----------
async function download(url, file, from, to) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  const tmp = file + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  for await (const c of res.body) {
    got += c.length;
    if (!out.write(c)) await new Promise(r => out.once('drain', r));
    if (total) install.progress = from + (to - from) * (got / total);
  }
  await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
  await fsp.rename(tmp, file);
}
function unzip(zip, dir) {
  // Windows 10/11 hat tar.exe eingebaut (kann .zip)
  return new Promise((resolve, reject) => execFile('tar', ['-xf', zip, '-C', dir], { windowsHide: true }, (e) => (e ? reject(e) : resolve())));
}
async function writableDir() {
  for (const d of dirs()) {
    try { await fsp.mkdir(d, { recursive: true }); await fsp.access(d, fs.constants.W_OK); return d; } catch (e) { /* nächster */ }
  }
  throw new Error('Kein beschreibbarer Ordner gefunden.');
}
async function runInstall() {
  if (install.state === 'running') return;
  Object.assign(install, { state: 'running', progress: 0, error: '' });
  try {
    const d = await writableDir();
    if (!fs.existsSync(path.join(d, EXE))) {
      const zip = path.join(d, 'whisper-bin.zip');
      await download(BIN_URL, zip, 0, 0.03);
      const tmp = path.join(d, '_entpackt');
      await fsp.mkdir(tmp, { recursive: true });
      await unzip(zip, tmp);
      const rel = path.join(tmp, 'Release');
      const src = fs.existsSync(rel) ? rel : tmp;
      for (const f of await fsp.readdir(src)) if (f === EXE || /^(whisper|ggml.*)\.dll$/i.test(f)) await fsp.copyFile(path.join(src, f), path.join(d, f));
      await fsp.rm(tmp, { recursive: true, force: true }); await fsp.rm(zip, { force: true });
    }
    if (!fs.existsSync(path.join(d, MODEL_FILE))) await download(MODEL_URL, path.join(d, MODEL_FILE), 0.03, 1);
    Object.assign(install, { state: 'done', progress: 1 });
  } catch (e) {
    Object.assign(install, { state: 'error', error: e.message });
  }
}

// ---------- HTTP ----------
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); res.end(JSON.stringify(obj)); }

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const power = url.searchParams.get('power') || 'normal';
  if (url.pathname === '/stt/status') {
    const f = find();
    return json(res, 200, { installed: !!f, running: !!child && !starting, model: f ? path.basename(f.model) : '', threads: threadsFor(power), cores: os.cpus().length, install });
  }
  if (url.pathname === '/stt/install' && req.method === 'POST') { runInstall(); return json(res, 200, { ok: true }); }
  if (url.pathname === '/stt/stop' && req.method === 'POST') { stop(); return json(res, 200, { ok: true }); }
  if (url.pathname === '/stt/inference' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    busy++;
    try {
      await ensure(power);
      let r = await forward(Buffer.concat(chunks), req.headers['content-type'] || 'multipart/form-data');
      if (r.status >= 500) { stop(); await ensure(power); r = await forward(Buffer.concat(chunks), req.headers['content-type']); }
      res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      res.end(r.body);
    } catch (e) {
      json(res, 503, { error: e.message });
    } finally { busy--; touch(); }
    return;
  }
  json(res, 404, { error: 'unbekannt' });
}

module.exports = { handle, stop, init(ud) { userData = ud; migrate(); }, find, install: runInstall, installState: install };
