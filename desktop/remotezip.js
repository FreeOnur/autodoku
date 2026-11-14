// AutoDoku – nur einzelne Dateien aus einer großen ZIP im Internet laden (HTTP-Range)
// Beispiel: Ollama für Windows ist 1,6 GB (wegen NVIDIA-Treibern). Für normale Laptops reichen ~40 MB.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

async function finalUrl(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) throw new Error(`Download nicht gefunden (${res.status})`);
  return { url: res.url, size: +res.headers.get('content-length') };
}

async function range(url, a, b) {
  const res = await fetch(url, { headers: { range: `bytes=${a}-${b}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`Download fehlgeschlagen (${res.status})`);
  return res;
}
const rangeBuf = async (url, a, b) => Buffer.from(await (await range(url, a, b)).arrayBuffer());

// Inhaltsverzeichnis der ZIP lesen (auch ZIP64)
async function listEntries(src) {
  const tailLen = Math.min(src.size, 128 * 1024);
  const tail = await rangeBuf(src.url, src.size - tailLen, src.size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei');
  let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
    const z = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
    if (z < 0) throw new Error('ZIP64 ohne Verzeichnis');
    count = Number(tail.readBigUInt64LE(z + 32)); cdSize = Number(tail.readBigUInt64LE(z + 40)); cdOff = Number(tail.readBigUInt64LE(z + 48));
  }
  const cd = await rangeBuf(src.url, cdOff, cdOff + cdSize - 1);
  const out = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let off = cd.readUInt32LE(p + 42);
    const name = cd.slice(p + 46, p + 46 + nl).toString('utf8');
    // ZIP64-Zusatzfeld: echte Größen/Offset
    let e = p + 46 + nl; const eEnd = e + el;
    while (e + 4 <= eEnd) {
      const id = cd.readUInt16LE(e), len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (off === 0xffffffff) { off = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + len;
    }
    out.push({ name, method, csize, usize, off });
    p = eEnd + cl;
  }
  return out;
}

async function extractEntry(src, entry, dest, onBytes) {
  const head = await rangeBuf(src.url, entry.off, entry.off + 29);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP-Eintrag beschädigt: ' + entry.name);
  const start = entry.off + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  if (entry.csize === 0) { await fsp.writeFile(tmp, ''); }
  else {
    const res = await range(src.url, start, start + entry.csize - 1);
    const body = Readable.fromWeb(res.body);
    body.on('data', (c) => onBytes && onBytes(c.length));
    if (entry.method === 0) await pipeline(body, fs.createWriteStream(tmp));
    else if (entry.method === 8) await pipeline(body, zlib.createInflateRaw(), fs.createWriteStream(tmp));
    else throw new Error('Unbekannte ZIP-Kompression: ' + entry.method);
  }
  await fsp.rm(dest, { force: true });
  await fsp.rename(tmp, dest);
}

// Lädt alle Einträge, für die keep(name) true ist, nach destDir. onProgress(0..1)
async function extractRemote(url, destDir, keep, onProgress) {
  const src = await finalUrl(url);
  const entries = (await listEntries(src)).filter(e => !e.name.endsWith('/') && keep(e.name));
  if (!entries.length) throw new Error('Nichts zum Entpacken gefunden');
  const total = entries.reduce((a, e) => a + e.csize, 0) || 1;
  let got = 0;
  for (const e of entries) {
    const rel = e.name.split('/').filter(x => x && x !== '..');
    let tries = 0;
    for (;;) {
      try { await extractEntry(src, e, path.join(destDir, ...rel), (n) => { got += n; onProgress && onProgress(Math.min(1, got / total)); }); break; }
      catch (err) {
        if (++tries > 3) throw err;
        await new Promise(r => setTimeout(r, 1500 * tries));
        Object.assign(src, await finalUrl(url)); // signierte Download-Adresse kann ablaufen
      }
    }
  }
  return entries.map(e => e.name);
}

module.exports = { extractRemote, listEntries, finalUrl };
