/* AutoDoku – Bilder: Fotos verkleinern, frei lizenzierte Bilder auf Wikimedia Commons finden */
(function (root) {
  'use strict';

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
      img.src = src;
    });
  }

  // Bild (File/Blob/URL) -> JPEG-DataURL mit max. Kantenlänge
  async function toJpeg(source, maxSide = 1600, quality = 0.84) {
    let url = source, revoke = false;
    if (source instanceof Blob) { url = URL.createObjectURL(source); revoke = true; }
    try {
      const img = await loadImage(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      const s = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      return { dataUrl: c.toDataURL('image/jpeg', quality), w, h };
    } finally {
      if (revoke) URL.revokeObjectURL(url);
    }
  }

  const strip = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  };

  async function searchCommons(term, limit = 12) {
    const q = `${term} filetype:bitmap|drawing`;
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
      `&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(q)}` +
      '&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=900&iiextmetadatafilter=Artist|LicenseShortName|ObjectName';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Bildersuche nicht erreichbar');
    const data = await res.json();
    const pages = Object.values((data.query && data.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    return pages.map(p => {
      const ii = (p.imageinfo || [])[0];
      if (!ii || !ii.thumburl || !/^image\//.test(ii.mime || '')) return null;
      const md = ii.extmetadata || {};
      const artist = strip(md.Artist && md.Artist.value).slice(0, 60);
      const license = strip(md.LicenseShortName && md.LicenseShortName.value);
      return {
        title: (md.ObjectName && strip(md.ObjectName.value)) || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
        thumb: ii.thumburl,
        page: ii.descriptionurl,
        w: ii.thumbwidth, h: ii.thumbheight,
        credit: ['Wikimedia Commons', artist, license].filter(Boolean).join(' · '),
      };
    }).filter(Boolean);
  }

  async function fetchAsJpeg(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Download fehlgeschlagen');
    const blob = await res.blob();
    return toJpeg(blob, 1400, 0.9);
  }

  root.Images = { toJpeg, searchCommons, fetchAsJpeg };
})(window);
