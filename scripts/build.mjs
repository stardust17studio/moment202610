// Builds the static gallery into docs/ (served by GitHub Pages from main → /docs).
//   src/photos.json   curated content: chapters, titles, alt text
//   src/index.html    page template ({{token}} placeholders)
//   src/assets/       css / js / favicon, copied verbatim
//   pictures/         full-resolution originals (never published)
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import exifReader from 'exif-reader';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const PICTURES = path.join(ROOT, 'pictures');
const OUT = path.join(ROOT, 'docs');
const FONT_DIR = path.join(ROOT, 'node_modules/@fontsource/cormorant-garamond');
const FONTS = ['300-normal', '300-italic', '400-normal', '400-italic', '500-normal'].map(
  (v) => `cormorant-garamond-latin-${v}.woff2`,
);

// Small variants are width-bound; the large one is bound by its long edge.
const VARIANTS = [
  { dir: '640', resize: { width: 640 }, quality: 78, sharpen: true },
  { dir: '1200', resize: { width: 1200 }, quality: 80, sharpen: true },
  { dir: '2400', resize: { width: 2400, height: 2400, fit: 'inside' }, quality: 82, sharpen: false },
];

const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const slugify = (text) =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const pad = (n) => String(n).padStart(2, '0');

const mtime = async (file) => {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
};

function formatExif(exif) {
  const photo = exif?.Photo ?? {};
  const image = exif?.Image ?? {};
  const iso = Array.isArray(photo.ISOSpeedRatings) ? photo.ISOSpeedRatings[0] : photo.ISOSpeedRatings;
  const t = photo.ExposureTime;
  const settings = [
    photo.FocalLength && `${Math.round(photo.FocalLength)}mm`,
    photo.FNumber && `ƒ/${Number(photo.FNumber.toFixed(1))}`,
    t && (t >= 1 ? `${Number(t.toFixed(1))}s` : `1/${Math.round(1 / t)}s`),
    iso && `ISO ${iso}`,
  ].filter(Boolean);
  return {
    settings: settings.join(' · '),
    gear: [image.Model, photo.LensModel].filter(Boolean).join(' · '),
  };
}

async function processPhoto(entry, slug) {
  const source = path.join(PICTURES, entry.file);
  const sourceTime = await mtime(source);
  if (!sourceTime) throw new Error(`Missing source image: pictures/${entry.file}`);

  const meta = await sharp(source).metadata();
  const exif = meta.exif ? exifReader(meta.exif) : null;

  const variants = [];
  for (const variant of VARIANTS) {
    const rel = `photos/${variant.dir}/${slug}.webp`;
    const target = path.join(OUT, rel);
    if ((await mtime(target)) < sourceTime) {
      await mkdir(path.dirname(target), { recursive: true });
      let pipeline = sharp(source).rotate().resize({ ...variant.resize, withoutEnlargement: true });
      if (variant.sharpen) pipeline = pipeline.sharpen({ sigma: 0.45 });
      await pipeline.webp({ quality: variant.quality, effort: 5 }).toFile(target);
    }
    const { width, height } = await sharp(target).metadata();
    variants.push({ rel, width, height });
  }

  const lqip = await sharp(path.join(OUT, variants[0].rel))
    .resize(24)
    .webp({ quality: 40 })
    .toBuffer();

  return {
    slug,
    source,
    variants,
    width: variants.at(-1).width,
    height: variants.at(-1).height,
    lqip: `data:image/webp;base64,${lqip.toString('base64')}`,
    ...formatExif(exif),
  };
}

// Tiled layout: photos are grouped into rows of equal height that fill the page width.
// A photo marked "feature" gets a row of its own, as does any photo left over on its own.
const ROW_TARGET = 2.9; // ideal sum of aspect ratios per row
function splitRows(photos) {
  const rows = [];
  let run = [];
  const flush = () => {
    const n = run.length;
    const best = Array(n + 1).fill(Infinity);
    const from = Array(n + 1).fill(0);
    best[0] = 0;
    for (let i = 1; i <= n; i++) {
      for (let k = 1; k <= Math.min(3, i); k++) {
        const sum = run.slice(i - k, i).reduce((acc, p) => acc + p.width / p.height, 0);
        const cost = best[i - k] + (sum - ROW_TARGET) ** 2 + (k === 1 ? 1.5 : 0) + (k === 3 ? 1.2 : 0);
        if (cost < best[i]) {
          best[i] = cost;
          from[i] = k;
        }
      }
    }
    const chunk = [];
    for (let i = n; i > 0; i -= from[i]) chunk.unshift(run.slice(i - from[i], i));
    rows.push(...chunk);
    run = [];
  };
  for (const photo of photos) {
    if (photo.feature) {
      flush();
      rows.push([photo]);
    } else run.push(photo);
  }
  flush();
  return rows;
}

function renderWork(photo, number, sizes) {
  const [, medium, large] = photo.variants;
  const srcset = photo.variants.map((v) => `${v.rel} ${v.width}w`).join(', ');
  const ratio = (photo.width / photo.height).toFixed(4);
  return `
          <figure class="work" id="${esc(photo.slug)}" style="--ar:${ratio}">
            <a class="work__frame" href="${esc(large.rel)}" style="--lqip:url(${photo.lqip})"
               data-title="${esc(photo.title)}"
               data-meta="${esc(photo.settings)}"
               data-gear="${esc(photo.gear)}" data-no="${pad(number)}">
              <img src="${esc(medium.rel)}" srcset="${esc(srcset)}" sizes="${sizes}"
                   width="${medium.width}" height="${medium.height}" alt="${esc(photo.alt)}"
                   loading="lazy" decoding="async">
            </a>
            <figcaption class="work__caption">
              <span class="work__title">${esc(photo.title)}</span>
              <span class="work__meta">${esc(photo.settings)}</span>
            </figcaption>
          </figure>`;
}

function renderRow(row, startNumber) {
  const ratios = row.map((p) => p.width / p.height);
  const sum = ratios.reduce((a, b) => a + b, 0);
  const solo = row.length === 1;
  const works = row
    .map((p, i) => {
      const sizes = solo
        ? `(min-width: 700px) min(100vw, calc(86vh * ${ratios[i].toFixed(3)})), 100vw`
        : `(min-width: 700px) ${Math.round((100 * ratios[i]) / sum)}vw, 100vw`;
      return renderWork(p, startNumber + i, sizes);
    })
    .join('');
  return `
        <div class="row${solo ? ' row--solo' : ''}">${works}
        </div>`;
}

function renderChapter(chapter, startNumber) {
  let number = startNumber;
  const works = splitRows(chapter.photos)
    .map((row) => {
      const html = renderRow(row, number);
      number += row.length;
      return html;
    })
    .join('');
  const count = chapter.photos.length;
  return `
    <section class="chapter" id="${esc(chapter.id)}" aria-labelledby="${esc(chapter.id)}-title">
      <header class="chapter__head reveal">
        <span class="chapter__numeral" aria-hidden="true">${esc(chapter.numeral)}</span>
        <div>
          <h2 class="chapter__title" id="${esc(chapter.id)}-title">${esc(chapter.title)}</h2>
          <p class="chapter__meta">${count} ${count === 1 ? 'work' : 'works'}</p>
        </div>
      </header>
      <div class="works">${works}
      </div>
    </section>`;
}

function render(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Template token {{${key}}} has no value`);
    return vars[key];
  });
}

async function pruneDir(dir, keep) {
  for (const name of await readdir(dir).catch(() => [])) {
    if (!keep.has(name)) await rm(path.join(dir, name), { recursive: true, force: true });
  }
}

async function main() {
  const started = Date.now();
  const content = JSON.parse(await readFile(path.join(SRC, 'photos.json'), 'utf8'));
  const { site } = content;

  await mkdir(OUT, { recursive: true });

  const seen = new Set();
  const all = [];
  for (const chapter of content.chapters) {
    chapter.photos = await Promise.all(
      chapter.photos.map(async (entry) => {
        let slug = slugify(entry.title) || slugify(path.parse(entry.file).name);
        while (seen.has(slug)) slug += '-2';
        seen.add(slug);
        const processed = { ...entry, ...(await processPhoto(entry, slug)) };
        all.push(processed);
        process.stdout.write(`  ✓ ${entry.file} → ${slug}\n`);
        return processed;
      }),
    );
  }

  for (const variant of VARIANTS) {
    await pruneDir(path.join(OUT, 'photos', variant.dir), new Set(all.map((p) => `${p.slug}.webp`)));
  }
  await pruneDir(path.join(OUT, 'photos'), new Set(VARIANTS.map((v) => v.dir)));

  const cover = all.find((p) => p.file === site.background.file);
  if (!cover) throw new Error(`Background ${site.background.file} must also be listed in a chapter`);

  // Social preview card (1200×630 JPEG for the widest platform support).
  const og = path.join(OUT, 'og.jpg');
  if ((await mtime(og)) < (await mtime(cover.source))) {
    await sharp(cover.source).rotate().resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toFile(og);
  }

  // Static assets.
  await rm(path.join(OUT, 'assets'), { recursive: true, force: true });
  await mkdir(path.join(OUT, 'assets/fonts'), { recursive: true });
  for (const name of await readdir(path.join(SRC, 'assets'))) {
    await copyFile(path.join(SRC, 'assets', name), path.join(OUT, 'assets', name));
  }
  for (const font of FONTS) {
    await copyFile(path.join(FONT_DIR, 'files', font), path.join(OUT, 'assets/fonts', font));
  }
  await copyFile(path.join(FONT_DIR, 'LICENSE'), path.join(OUT, 'assets/fonts/OFL.txt'));
  await writeFile(path.join(OUT, '.nojekyll'), '');

  // Page.
  let number = 1;
  const chapters = content.chapters
    .map((chapter) => {
      const html = renderChapter(chapter, number);
      number += chapter.photos.length;
      return html;
    })
    .join('\n');
  const nav = content.chapters
    .map(
      (c) =>
        `<a href="#${esc(c.id)}"><span class="nav__no" aria-hidden="true">${esc(c.numeral)}</span><span class="nav__label">${esc(c.title)}</span></a>`,
    )
    .join('');
  const [bgSmall, bgMedium] = cover.variants;
  const template = await readFile(path.join(SRC, 'index.html'), 'utf8');
  const html = render(template, {
    lang: esc(site.lang),
    title: esc(site.title),
    studio: esc(site.studio),
    description: esc(site.description),
    url: esc(site.url),
    og_image: esc(new URL('og.jpg', site.url).href),
    intro: esc(site.intro),
    count: String(all.length),
    bg_src: esc(bgMedium.rel),
    bg_srcset: esc(cover.variants.map((v) => `${v.rel} ${v.width}w`).join(', ')),
    bg_soft: esc(bgSmall.rel),
    bg_lqip: cover.lqip,
    bg_focus: esc(site.background.focus),
    cover_slug: esc(cover.slug),
    cover_title: esc(cover.title),
    nav,
    chapters,
  });
  await writeFile(path.join(OUT, 'index.html'), html);

  console.log(`Built ${all.length} photos into docs/ in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
