# Moment — Stardust 17 Studio

A quiet photography gallery. The snow photograph is the page backdrop; the rest is
laid out like a gallery wall, with a lightbox viewer.

Live site: https://stardust17studio.github.io/moment202610/

## Structure

- `pictures/` — original JPEGs (build input only; git-ignored to keep the repo small, so keep them locally)
- `src/photos.json` — titles, chapters, alt text and site metadata
- `src/index.html`, `src/assets/` — page template, styles and scripts
- `scripts/build.mjs` — generates `docs/` (WebP sizes, placeholders, EXIF captions, OG image)
- `docs/` — generated site, served by GitHub Pages

## Develop

```sh
npm install
npm run build   # regenerate docs/
npm run serve   # preview at http://localhost:4173
```

To add a photo, drop the JPEG in `pictures/`, list it in `src/photos.json`, and rebuild.

## Deploy

In the repository settings, set **Pages → Source** to branch `main`, folder `/docs`.

Fonts: Cormorant Garamond (SIL OFL, see `docs/assets/fonts/OFL.txt`).
