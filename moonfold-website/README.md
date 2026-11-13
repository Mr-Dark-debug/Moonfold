# Moonfold website

Standalone marketing site for Moonfold. Production: **https://moonfold-website.vercel.app/**.

## Develop

Use Node.js 22 or newer. The site has no runtime dependencies. Only the docs and blog generator needs `npm install` (it uses `marked`, MIT).

```powershell
cd D:\projects\Moonfold\moonfold-website
npm run dev
```

Open `http://127.0.0.1:4317`. The development server binds to loopback and uses this folder only. Set `PORT` to use a different port. Reload after editing source.

```powershell
npm run check
npm run build
npm run preview
```

`src/` contains the page, stylesheet, and small interaction script. `public/` contains self-hosted assets. The build copies these into `dist/`. The source validator checks local assets, navigation and ARIA references, unique IDs, image dimensions, external link attributes, and deployment configuration. JavaScript syntax is checked by Node.

## Seasonal overlay

In the local winter or autumn the homepage dresses for the season: snow settles on the top edges of the cards, tiles, buttons and the hero hill, leaves drift down and pile up the same way. Moving the pointer across a pile brushes it away. With `prefers-reduced-motion` the scene renders already settled and still answers the brush.

The mode is chosen automatically from the visitor's rough location and the live weather there (geojs.io, falling back to ipwho.is, then Open-Meteo), recalculated at most every 12 hours and cached for the week in `localStorage`; without a location answer the calendar alone decides. The snowflake button in the header cycles automatic → snow → leaves → off and remembers the choice, and `?season=snow|leaves|off|auto` forces a mode without storing anything.

Two things must stay in sync when touching these files: `season.js` and `seasonal.js` belong in the copy list of `scripts/build.mjs`, and the CSP in `vercel.json` must keep `get.geojs.io`, `ipwho.is` and `api.open-meteo.com` allowed under `connect-src`, or the automatic choice silently degrades to the calendar.

## Docs and blog

`/docs/` and `/blog/` are generated static pages, committed under `public/` so the Vercel build stays a plain copy.

- Docs come from `../docs/user/*.md`, the same files the GitHub Pages docs use. Edit the Markdown there, not the generated HTML.
- Blog posts are Markdown files in `content/blog/` with `title`, `description`, `category` and `date` frontmatter (add `featured: true` to one post). Posts dated in the future fail the build. Write only what is true of the shipped product.
- Run `npm install` once, then `npm run content` after changing either source, and commit the regenerated `public/docs`, `public/blog` and `public/sitemap.xml`. `npm run check` verifies every internal link in them.
- Styles live in `src/content.css` and the small filter script in `src/content.js`.

## Deploy

The Vercel project is `prashant-project/moonfold-website`. Run deployments from this folder, not the parent application repository:

```powershell
npx vercel@64.3.1 link --project moonfold-website --scope prashant-project
npx vercel@64.3.1 deploy --prod --scope prashant-project
```

The current project uses manual deployments. Its Git integration is disconnected so unrelated application pushes cannot trigger a build of the wrong directory. If enabling Git deployment later, set the project root directory to `moonfold-website` first. Vercel authentication is limited to previews; the production site is public. Never publish `.vercel`, `.env` files, or provider credentials.

## Content and assets

The copy is based on `CLAUDE.md`, `BUILD-PLAN.md`, `LAUNCH-PLAN.md`, `PROGRESS.md`, and `docs/BRAND.md`. Provider handoff and Gemini CLI are labeled as planned. The handoff panel is an interactive concept diagram, not a product screenshot or live provider session. Links point to the real public repository and documents. There are no invented statistics, testimonials, downloads, subscriptions, or forms.

- `public/assets/moonfold-mark.svg`: existing project artwork from `assets/brand/`.
- `public/assets/hero-art-*.webp`: the hero's halftone landscape, a ringed moon over mountain ranges in peach dots on a transparent canvas (the cobalt background is CSS). It is generated, not drawn: `python art/render-hero-art.py <out-dir>` (needs numpy, scipy and Pillow) rebuilds both sizes from a fixed seed, using Moonfold's own mark for the moon. Copy the two `.webp` files into `public/assets/`. The foreground hill is drawn in the page colour so the hero melts into the section below it.
- `public/assets/footer-landscape.webp`: original artwork generated with the same tool. Brief: an ivory and Prussian-blue copperplate engraving of a valley, winding river, cypresses, and an observatory, with a clear blue sky.
- `public/assets/social-card.jpg`: social card composed from the earlier painterly hero artwork.
- Manrope and Instrument Serif: self-hosted Google Fonts, licensed under SIL OFL. The corresponding license texts are retained beside the fonts. No third-party provider marks are used.

Original generation outputs remain in the owner's Codex generated-images folder; all assets the website consumes are included in this folder. There are no production runtime packages, analytics, or remote font requests.

## Verification — 16 October 2026

- `npm run check`: passed (19 unique IDs and 9 referenced local assets checked).
- `npm run build`: passed; approximately 1.53 MB total static output, including all responsive image variants, fonts, and social artwork.
- Prettier 3.8.1 scoped formatting check: passed.
- Browser checks at 1440, 1280, 768, 390, and 320 CSS pixels: no horizontal overflow. Desktop, tablet, and phone layouts visually inspected.
- Verified section links, mobile menu open/navigation/close, keyboard tab selection, FAQ opening and exclusive expansion, and the footer illustration. Browser console had no warnings or errors.
- Vercel production build succeeded and assigned `https://moonfold-website.vercel.app/`. The public alias returned HTTP 200 with the expected page title, and hosted tabs/FAQ worked in a real browser.

This verifies the marketing website. It does not establish completion or release readiness of the Moonfold application.
