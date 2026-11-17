/**
 * Rasterizes the committed A6 SVG sources into PNG icons and a Windows ICO.
 *
 * Run with Electron (Chromium is the rasterizer, so no new image dependency
 * is introduced):
 *   pnpm generate:icons
 *
 * The SVG sources under the repository root are treated as read-only. The
 * generated PNGs and the hand-written ICO are committed build assets.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ICON_DIR = path.join(ROOT, 'apps', 'desktop', 'icons');

// Small, simplified SVG for the sizes where detail would turn to noise;
// the full SVG for the larger sizes (including the app/taskbar icon).
const TARGETS = [
  { size: 16, source: 'a6-logo-small.svg' },
  { size: 24, source: 'a6-logo-small.svg' },
  { size: 32, source: 'a6-logo-small.svg' },
  { size: 48, source: 'a6-logo-small.svg' },
  { size: 64, source: 'a6-logo.svg' },
  { size: 128, source: 'a6-logo.svg' },
  { size: 256, source: 'a6-logo.svg' },
];

/** Reads a big-endian width/height from a PNG header to verify the raster. */
function pngDimensions(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Rasterizes an SVG string to an exact-size PNG buffer using Chromium. */
async function rasterize(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,<body></body>');
    const script = `new Promise((resolve, reject) => {
      const svg = ${JSON.stringify(svg)};
      const img = new Image();
      img.onerror = () => reject(new Error('SVG decode failed'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = ${size};
        canvas.height = ${size};
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    })`;
    const dataUrl = await win.webContents.executeJavaScript(script);
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    const dims = pngDimensions(png);
    if (dims.width !== size || dims.height !== size) {
      throw new Error(
        `raster ${size} produced ${dims.width}x${dims.height}`,
      );
    }
    return png;
  } finally {
    win.close();
  }
}

/** Writes an ICO with PNG-compressed entries (Vista+ format). */
function writeIco(entries, output) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directorySize = 16 * entries.length;
  let offset = header.length + directorySize;
  const directories = [];
  const images = [];
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size; // 0 encodes 256
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0; // palette colours
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    directories.push(entry);
    images.push(png);
  }
  fs.writeFileSync(output, Buffer.concat([header, ...directories, ...images]));
}

async function run() {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  const rendered = [];
  for (const { size, source } of TARGETS) {
    const svg = fs.readFileSync(path.join(ROOT, source), 'utf8');
    const png = await rasterize(svg, size);
    fs.writeFileSync(path.join(ICON_DIR, `a6-${size}.png`), png);
    rendered.push({ size, png });
    console.log(`generated a6-${size}.png (${png.length} bytes)`);
  }
  const ico = path.join(ICON_DIR, 'a6.ico');
  writeIco(rendered, ico);
  console.log(`generated ${path.relative(ROOT, ico)} (${rendered.length} entries)`);
}

app.whenReady().then(() => {
  run()
    .then(() => app.quit())
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
});
