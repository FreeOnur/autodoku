// AutoDoku – Updates von GitHub Releases
//   GET  /update/check     -> { current, latest, newer, notes, url }
//   POST /update/install   -> lädt AutoDoku-Setup.exe und startet es (AutoDoku beendet sich dabei)
//   GET  /update/status    -> Fortschritt
const { app, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const REPO = 'FreeOnur/autodoku';
const state = { state: 'idle', progress: 0, error: '' };
let cache = null;

const parse = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
function newer(a, b) { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }

async function check(force) {
  if (cache && !force && Date.now() - cache.at < 3600e3) return cache.data;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'AutoDoku' } });
  if (!res.ok) throw new Error('GitHub nicht erreichbar (' + res.status + ')');
  const r = await res.json();
  const exe = (r.assets || []).find(a => /setup.*\.exe$/i.test(a.name));
  const data = {
    current: app.getVersion(), latest: (r.tag_name || '').replace(/^v/, ''),
    newer: newer(r.tag_name, app.getVersion()) && !!exe,
    notes: (r.body || '').slice(0, 2000), page: r.html_url, url: exe ? exe.browser_download_url : '', size: exe ? exe.size : 0,
  };
  cache = { at: Date.now(), data };
  return data;
}

async function install() {
  if (state.state === 'running') return;
  Object.assign(state, { state: 'running', progress: 0, error: '' });
  try {
    const info = await check(true);
    if (!info.newer) throw new Error('Du hast schon die neueste Version.');
    const file = path.join(os.tmpdir(), `AutoDoku-Setup-${info.latest}.exe`);
    const res = await fetch(info.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error('Download fehlgeschlagen (' + res.status + ')');
    const total = +res.headers.get('content-length') || info.size || 1;
    let got = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (c) => { got += c.length; state.progress = Math.min(0.99, got / total); });
    await pipeline(body, fs.createWriteStream(file));
    state.progress = 1; state.state = 'starting';
    // Installer starten und AutoDoku beenden (der Installer startet AutoDoku danach neu)
    spawn(file, ['--updated'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 800);
  } catch (e) {
    Object.assign(state, { state: 'error', error: e.message });
  }
}

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); res.end(JSON.stringify(obj)); }
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/update/check') return json(res, 200, await check(url.searchParams.has('force')));
    if (url.pathname === '/update/install' && req.method === 'POST') { install(); return json(res, 200, { ok: true }); }
    if (url.pathname === '/update/status') return json(res, 200, state);
    if (url.pathname === '/update/page') { const i = await check(); shell.openExternal(i.page); return json(res, 200, { ok: true }); }
  } catch (e) { return json(res, 500, { error: e.message }); }
  json(res, 404, { error: 'unbekannt' });
}

module.exports = { handle, check };
