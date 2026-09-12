/* ═══════════════════════════════════════════
   assets/img → WebP

   No image tooling was on the build machine, so this is the one-off:

     npm  install sharp --no-save
     node tools/optimize-images.mjs            # write .webp beside each original
     node tools/optimize-images.mjs --rewrite  # ...and repoint the HTML at them

   Originals are never deleted. Re-run is safe: a .webp newer than its source
   is skipped. Keep the originals until the WebP versions are deployed and
   checked — `--rewrite` only edits src/srcset attributes, so reverting is a
   find-and-replace away.
   ═══════════════════════════════════════════ */

import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, extname, basename, dirname } from 'node:path';

const IMG_DIR  = 'assets/img';
const PAGES    = ['index.html', 'privacy-policy/index.html', 'terms-and-conditions/index.html'];
const MAX_W    = 2000;   // nothing in this layout is displayed wider
const QUALITY  = 82;
const REWRITE  = process.argv.includes('--rewrite');

const SOURCES = new Set(['.jpg', '.jpeg', '.png']);
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('sharp is not installed.  Run:  npm install sharp --no-save');
  process.exit(1);
}

const walk = async (dir) => {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (SOURCES.has(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
};

const files = await walk(IMG_DIR);
let before = 0, after = 0, written = 0, skipped = 0;

for (const src of files) {
  const dest = join(dirname(src), basename(src, extname(src)) + '.webp');
  const s = await stat(src);
  before += s.size;

  const fresh = await stat(dest).then((d) => d.mtimeMs > s.mtimeMs).catch(() => false);
  if (fresh) {
    after += (await stat(dest)).size;
    skipped++;
    continue;
  }

  const img = sharp(src);
  const { width } = await img.metadata();
  await img
    .resize({ width: Math.min(width ?? MAX_W, MAX_W), withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(dest);

  const d = await stat(dest);
  after += d.size;
  written++;
  console.log(`  ${mb(s.size).padStart(8)} → ${mb(d.size).padStart(8)}   ${src}`);
}

console.log(`\n${written} written, ${skipped} already current`);
console.log(`${mb(before)} → ${mb(after)}  (${Math.round((1 - after / before) * 100)}% smaller)`);

if (!REWRITE) {
  console.log('\nHTML untouched. Re-run with --rewrite to repoint it at the .webp files.');
  process.exit(0);
}

/* Only touches src="…" and srcset="…" inside assets/img, so hand-written
   markup elsewhere in the page is left alone. */
const pattern = /((?:src|srcset)=")([^"]*assets\/img\/[^"]*?)\.(jpe?g|png)(")/gi;
for (const page of PAGES) {
  const html = await readFile(page, 'utf8');
  let n = 0;
  const next = html.replace(pattern, (_m, a, path, _ext, z) => { n++; return `${a}${path}.webp${z}`; });
  if (n) {
    await writeFile(page, next);
    console.log(`rewrote ${n} reference${n === 1 ? '' : 's'} in ${page}`);
  }
}
console.log('\nCheck every image renders, then the originals can go.');
