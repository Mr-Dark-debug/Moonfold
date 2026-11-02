// Generates the documentation and blog pages as static HTML into public/docs and public/blog.
//
//   npm run content
//
// Docs come from ../docs/user/*.md (the same files the GitHub Pages docs use), blog posts from
// content/blog/*.md. The output is committed, so the Vercel build stays a plain copy with no
// install step. `marked` is a dev dependency of this generator only; nothing ships to the browser.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Marked } from "marked";

const root = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = path.resolve(root, "..");
const SITE = "https://moonfold-website.vercel.app";
const REPO = "https://github.com/Mr-Dark-debug/Moonfold";
const today = new Date().toISOString().slice(0, 10);

const escapeHtml = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

const stripMarkdown = (text) =>
  text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1");

// ---------------------------------------------------------------------------
// Markdown

function makeMarkdown({ rewrite, toc }) {
  const seen = new Map();
  const marked = new Marked({
    gfm: true,
    walkTokens: (token) => {
      if (token.type === "link") token.href = rewrite(token.href);
    },
    renderer: {
      heading({ tokens, depth, text }) {
        const base = slugify(text) || "section";
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        const inner = this.parser.parseInline(tokens);
        if (depth === 2) toc.push({ id, text: stripMarkdown(text) });
        return depth === 2 || depth === 3
          ? `<h${depth} id="${id}"><a class="anchor" href="#${id}">${inner}</a></h${depth}>\n`
          : `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      table({ header, rows }) {
        const cell = (c, tag) =>
          `<${tag}${c.align ? ` align="${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${header.map((c) => cell(c, "th")).join("")}</tr>`;
        const body = rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
        return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
      },
      link({ href, title, tokens }) {
        const external = /^https?:\/\//i.test(href);
        const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(href)}"${t}${attrs}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return { render: (md) => (seen.clear(), marked.parse(md, { async: false })) };
}

function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source.replace(/\r\n/g, "\n"));
  if (!match) throw new Error("Blog post is missing frontmatter");
  const data = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) {
      // A value may be quoted (YAML style) when it contains a colon.
      const value = line.slice(at + 1).trim();
      data[line.slice(0, at).trim()] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
    }
  }
  return { data, body: source.replace(/\r\n/g, "\n").slice(match[0].length) };
}

// ---------------------------------------------------------------------------
// Shared page chrome

function header(active) {
  const link = (href, label, key) =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<a class="skip-link" href="#content">Skip to content</a>
<header class="sp-header">
  <a class="sp-brand" href="/">Moonfold<span class="sp-dot">.</span></a>
  <nav class="sp-nav" aria-label="Site">
    ${link("/docs/", "Docs", "docs")}
    ${link("/blog/", "Blog", "blog")}
    <a class="sp-gh" href="${REPO}" target="_blank" rel="noopener noreferrer">GitHub</a>
  </nav>
  <a class="sp-pill" href="${REPO}/releases" target="_blank" rel="noopener noreferrer">Download <span aria-hidden="true">↗</span></a>
</header>`;
}

const footer = `<footer class="sp-footer">
  <div class="sp-footer-inner">
    <p><strong>Moonfold</strong> is open source under the MIT licence, built on <a href="https://github.com/pingdotgg/t3code" target="_blank" rel="noopener noreferrer">T3 Code</a>. It is not affiliated with or endorsed by OpenAI, Anthropic, Google, Cursor or any other provider it works with.</p>
    <nav aria-label="Footer">
      <a href="/">Home</a>
      <a href="/docs/">Docs</a>
      <a href="/blog/">Blog</a>
      <a href="${REPO}" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a href="${REPO}/releases" target="_blank" rel="noopener noreferrer">Releases</a>
    </nav>
  </div>
</footer>`;

function shell({
  title,
  description,
  canonical,
  bodyClass,
  active,
  main,
  jsonLd,
  type = "website",
}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#2236cc">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${SITE}${canonical}">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${SITE}/assets/social-card.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/assets/moonfold-mark.svg">
<link rel="preload" href="/assets/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/content.css">
<script src="/content.js" defer></script>${
    jsonLd
      ? `
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
      : ""
  }
</head>
<body class="${bodyClass}">
${header(active)}
${main}
${footer}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Docs

const SECTIONS = [
  {
    title: "Get started",
    blurb: "Install Moonfold, run it the first time and keep it up to date.",
    pages: [
      "install",
      "welcome-wizard",
      "updating",
      "remote-access",
      "mobile-app",
      "background-service",
    ],
  },
  {
    title: "Work with agents",
    blurb: "Threads, permissions, handoff and the tools agents can use.",
    pages: [
      "thread-sidebar",
      "composer",
      "permission-modes",
      "provider-handoff",
      "prompt-profiles",
      "portable-handoffs",
      "usage",
      "scheduled-tasks",
      "memories",
      "plugins",
      "agent-instructions",
      "artifacts",
      "computer-use",
      "agent-browsing",
    ],
  },
  {
    title: "Providers",
    blurb: "Connect the agent CLIs you already use, with your own logins.",
    pages: [
      "providers-codex",
      "providers-claude",
      "providers-gemini",
      "providers-acp",
      "cursor",
      "providers-opencode",
      "providers-antigravity",
      "providers-pi",
      "providers-muse",
      "providers-deepseek-harness",
    ],
  },
];

function rewriteDocLink(href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/"))
    return href;
  const [target = "", hash] = href.split("#", 2);
  const suffix = hash === undefined ? "" : `#${hash}`;
  const sibling = /^(?:\.\/)?([a-z0-9-]+)\.md$/i.exec(target);
  if (sibling) return `/docs/${sibling[1]}/${suffix}`;
  const resolved = path.posix.normalize(path.posix.join("docs/user", target));
  if (resolved.startsWith(".."))
    return `${REPO}/blob/main/${path.posix.normalize(path.posix.join("docs", target)).replace(/^\.\.\//, "")}${suffix}`;
  return `${REPO}/blob/main/${resolved}${suffix}`;
}

async function readDocs() {
  const dir = path.join(repoRoot, "docs", "user");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  return Promise.all(
    files.map(async (file) => {
      const markdown = await readFile(path.join(dir, file), "utf8");
      const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? file.slice(0, -3);
      const lead = markdown
        .replace(/^#\s+.+\n+/, "")
        .split(/\n\s*\n/)[0]
        .replace(/\s+/g, " ");
      return { name: file.slice(0, -3), title, markdown, lead: stripMarkdown(lead) };
    }),
  );
}

function groupDocs(docs) {
  const byName = new Map(docs.map((d) => [d.name, d]));
  const listed = new Set(SECTIONS.flatMap((s) => s.pages));
  const more = docs
    .filter((d) => !listed.has(d.name))
    .map((d) => d.name)
    .sort();
  return [...SECTIONS, { title: "More", blurb: "Everything else in the guide.", pages: more }]
    .map((s) => ({ ...s, docs: s.pages.map((n) => byName.get(n)).filter(Boolean) }))
    .filter((s) => s.docs.length);
}

function sidebar(groups, current) {
  const sections = groups
    .map(
      (g) =>
        `<section class="doc-nav-group"><h2>${escapeHtml(g.title)}</h2><ul>${g.docs
          .map(
            (d) =>
              `<li><a href="/docs/${d.name}/"${d.name === current ? ' aria-current="page"' : ""}>${escapeHtml(d.title)}</a></li>`,
          )
          .join("")}</ul></section>`,
    )
    .join("");
  return `<details class="doc-nav-mobile" open><summary>Browse the docs</summary>
<div class="doc-nav-body">
<label class="doc-search"><span class="sr-only">Filter pages</span><input type="search" placeholder="Filter pages" autocomplete="off" data-doc-filter></label>
${sections}
<p class="doc-empty" hidden data-doc-empty>No page matches that.</p>
</div></details>`;
}

async function buildDocs() {
  const docs = await readDocs();
  const groups = groupDocs(docs);
  const flat = groups.flatMap((g) => g.docs);
  const outRoot = path.join(root, "public", "docs");
  await rm(outRoot, { recursive: true, force: true });

  for (const [i, doc] of flat.entries()) {
    const toc = [];
    const md = makeMarkdown({ rewrite: rewriteDocLink, toc });
    const body = md.render(doc.markdown);
    const prev = flat[i - 1];
    const next = flat[i + 1];
    const group = groups.find((g) => g.docs.includes(doc));
    const pager = `<nav class="pager" aria-label="More pages">${
      prev
        ? `<a href="/docs/${prev.name}/"><small>Previous</small><span>${escapeHtml(prev.title)}</span></a>`
        : "<span></span>"
    }${
      next
        ? `<a class="next" href="/docs/${next.name}/"><small>Next</small><span>${escapeHtml(next.title)}</span></a>`
        : "<span></span>"
    }</nav>`;
    const tocHtml =
      toc.length > 1
        ? `<nav class="doc-toc" aria-label="On this page"><h2>On this page</h2><ul>${toc
            .map((t) => `<li><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`)
            .join("")}</ul></nav>`
        : "";
    const main = `<div class="doc-layout" id="content">
<aside class="doc-side">${sidebar(groups, doc.name)}</aside>
<article class="doc-main prose">
<p class="crumbs"><a href="/docs/">Docs</a><span aria-hidden="true">/</span>${escapeHtml(group.title)}</p>
${body}
<p class="doc-edit"><a href="${REPO}/edit/main/docs/user/${doc.name}.md" target="_blank" rel="noopener noreferrer">Edit this page on GitHub</a></p>
${pager}
</article>
<aside class="doc-aside">${tocHtml}</aside>
</div>`;
    const dir = path.join(outRoot, doc.name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "index.html"),
      shell({
        title: `${doc.title} · Moonfold docs`,
        description: doc.lead.slice(0, 200) || `${doc.title} in the Moonfold docs.`,
        canonical: `/docs/${doc.name}/`,
        bodyClass: "page-docs",
        active: "docs",
        main,
      }),
    );
  }

  const cards = groups
    .map(
      (g) => `<section class="doc-group">
<div class="doc-group-head"><h2>${escapeHtml(g.title)}</h2><p>${escapeHtml(g.blurb)}</p></div>
<ul class="doc-cards">${g.docs
        .map(
          (d) =>
            `<li data-doc-card><a href="/docs/${d.name}/"><strong>${escapeHtml(d.title)}</strong><span>${escapeHtml(d.lead.length > 130 ? `${d.lead.slice(0, 127).trimEnd()}…` : d.lead)}</span></a></li>`,
        )
        .join("")}</ul></section>`,
    )
    .join("");
  const index = `<main class="docs-home" id="content">
<div class="docs-hero">
<p class="eyebrow">Documentation</p>
<h1>Learn Moonfold.</h1>
<p class="lede">Install it, connect the agents you already use, and keep a task moving when one of them runs out. ${flat.length} pages, written in the open and editable on GitHub.</p>
<div class="docs-start">
<a class="btn btn-solid" href="/docs/install/">Install Moonfold</a>
<a class="btn btn-ghost" href="/docs/provider-handoff/">How handoff works</a>
</div>
<label class="doc-search doc-search-wide"><span class="sr-only">Search the docs</span><input type="search" placeholder="Search the docs" autocomplete="off" data-doc-search></label>
</div>
<div class="docs-groups">${cards}<p class="doc-empty" hidden data-doc-empty>No page matches that.</p></div>
<p class="docs-foot">Missing something? <a href="${REPO}/tree/main/docs/user" target="_blank" rel="noopener noreferrer">Every page lives in the repository</a> and takes pull requests.</p>
</main>`;
  await mkdir(outRoot, { recursive: true });
  await writeFile(
    path.join(outRoot, "index.html"),
    shell({
      title: "Moonfold docs — install, connect agents, hand off tasks",
      description:
        "The Moonfold documentation: install, provider guides for Codex, Claude Code and more, permission modes, remote access and provider handoff.",
      canonical: "/docs/",
      bodyClass: "page-docs-home",
      active: "docs",
      main: index,
    }),
  );
  return flat.map((d) => `/docs/${d.name}/`).concat("/docs/");
}

// ---------------------------------------------------------------------------
// Blog

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function readPosts() {
  const dir = path.join(root, "content", "blog");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const posts = await Promise.all(
    files.map(async (file) => {
      const { data, body } = frontmatter(await readFile(path.join(dir, file), "utf8"));
      for (const key of ["title", "description", "category", "date"]) {
        if (!data[key]) throw new Error(`${file}: missing "${key}"`);
      }
      if (data.date > today) throw new Error(`${file}: dated in the future`);
      const words = stripMarkdown(body).split(/\s+/).length;
      return {
        slug: file.slice(0, -3),
        ...data,
        featured: data.featured === "true",
        body,
        minutes: Math.max(1, Math.round(words / 200)),
      };
    }),
  );
  return posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

const catSlug = (c) => slugify(c);

function metaLine(p) {
  return `${formatDate(p.date)} · ${p.minutes} min read`;
}

function card(p, n) {
  return `<article class="post-card"><a href="/blog/${p.slug}/">
<span class="post-no" aria-hidden="true">${String(n).padStart(2, "0")}</span>
<span class="post-cat">${escapeHtml(p.category)}</span>
<h3>${escapeHtml(p.title)}</h3>
<p>${escapeHtml(p.description)}</p>
<span class="post-meta">${metaLine(p)}</span>
<span class="post-go">Read the post <span aria-hidden="true">→</span></span>
</a></article>`;
}

async function buildBlog() {
  const posts = await readPosts();
  const outRoot = path.join(root, "public", "blog");
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });
  const categories = [...new Set(posts.map((p) => p.category))].sort();
  const featured = posts.find((p) => p.featured) ?? posts[0];
  const latest = posts.filter((p) => p !== featured).slice(0, 3);

  for (const p of posts) {
    const toc = [];
    const md = makeMarkdown({ rewrite: (h) => h, toc });
    const body = md.render(p.body);
    const related = posts
      .filter((o) => o !== p)
      .sort((a, b) => Number(b.category === p.category) - Number(a.category === p.category))
      .slice(0, 3);
    const main = `<main class="post" id="content">
<div class="post-head">
<p class="crumbs"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/blog/">Blog</a><span aria-hidden="true">/</span><a href="/blog/#${catSlug(p.category)}">${escapeHtml(p.category)}</a></p>
<p class="eyebrow">${escapeHtml(p.category)}</p>
<h1>${escapeHtml(p.title)}</h1>
<p class="lede">${escapeHtml(p.description)}</p>
<dl class="post-facts">
<div><dt>Written by</dt><dd>The Moonfold team</dd></div>
<div><dt>Published</dt><dd><time datetime="${p.date}">${formatDate(p.date)}</time></dd></div>
<div><dt>Reading time</dt><dd>${p.minutes} min</dd></div>
</dl>
</div>
<div class="post-body-wrap">
<nav class="post-toc" aria-label="In this post"><h2>In this post</h2><ul>${toc
      .map((t) => `<li><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`)
      .join("")}</ul></nav>
<article class="prose">
${body}
<div class="post-cta"><p><strong>Try Moonfold.</strong> It is free, open source and runs the agents you already use, with your own logins.</p><a class="btn btn-solid" href="${REPO}/releases" target="_blank" rel="noopener noreferrer">Download the beta</a></div>
</article>
</div>
<section class="related"><h2>Keep reading</h2><div class="post-grid">${related.map((r, n) => card(r, n + 1)).join("")}</div></section>
</main>`;
    const dir = path.join(outRoot, p.slug);
    await mkdir(dir, { recursive: true });
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: p.title,
      description: p.description,
      datePublished: p.date,
      author: { "@type": "Organization", name: "The Moonfold team" },
      mainEntityOfPage: `${SITE}/blog/${p.slug}/`,
    };
    await writeFile(
      path.join(dir, "index.html"),
      shell({
        title: `${p.title} | Moonfold`,
        description: p.description,
        canonical: `/blog/${p.slug}/`,
        bodyClass: "page-post",
        active: "blog",
        type: "article",
        main,
        jsonLd,
      }),
    );
  }

  const tabs = [
    `<button type="button" class="tab" data-cat="all" aria-pressed="true">All</button>`,
    ...categories.map(
      (c) =>
        `<button type="button" class="tab" data-cat="${catSlug(c)}" aria-pressed="false">${escapeHtml(c)}</button>`,
    ),
  ].join("");
  const index = `<main class="blog-home" id="content">
<div class="blog-hero">
<div>
<p class="eyebrow">Moonfold field notes</p>
<h1>Notes from building a home for your agents.</h1>
</div>
<div class="blog-hero-side">
<p class="lede">How provider handoff works, what ships in each release, and the guides we wish we had when we started. Written plainly, including what does not work yet.</p>
<label class="blog-search"><span class="sr-only">Search the posts</span><input type="search" placeholder="Search the posts" autocomplete="off" data-blog-search></label>
</div>
</div>
<div class="tabs-bar"><div class="tabs" role="group" aria-label="Filter by topic">${tabs}</div></div>
<section class="featured" aria-labelledby="featured-title" data-blog-featured>
<div class="featured-inner">
<p class="eyebrow eyebrow-light">Featured · ${escapeHtml(featured.category)}</p>
<h2 id="featured-title">${escapeHtml(featured.title)}</h2>
<p>${escapeHtml(featured.description)}</p>
<p class="post-meta post-meta-light">${metaLine(featured)}</p>
<a class="btn btn-peach" href="/blog/${featured.slug}/">Read the post <span aria-hidden="true">→</span></a>
</div>
</section>
<section class="latest" data-blog-latest>
<div class="section-head"><p class="eyebrow">Latest</p><h2>Fresh from the build.</h2></div>
<div class="post-grid">${latest.map((p, n) => card(p, n + 1)).join("")}</div>
</section>
<section class="library" aria-labelledby="library-title">
<div class="section-head"><p class="eyebrow">The library</p><h2 id="library-title">All posts <span class="count" data-blog-count>${posts.length}</span></h2></div>
<ol class="library-list">${posts
    .map(
      (
        p,
        n,
      ) => `<li data-post data-cat="${catSlug(p.category)}" data-text="${escapeHtml(`${p.title} ${p.description} ${p.category}`.toLowerCase())}"><a href="/blog/${p.slug}/">
<span class="post-no" aria-hidden="true">${String(n + 1).padStart(2, "0")}</span>
<span class="lib-main"><span class="post-cat">${escapeHtml(p.category)}</span><strong>${escapeHtml(p.title)}</strong><span class="lib-desc">${escapeHtml(p.description)}</span></span>
<span class="post-meta">${metaLine(p)}</span>
</a></li>`,
    )
    .join("")}</ol>
<p class="doc-empty" hidden data-blog-empty>No posts match that yet.</p>
</section>
</main>`;
  await writeFile(
    path.join(outRoot, "index.html"),
    shell({
      title: "Moonfold blog — provider handoff, releases and guides",
      description:
        "Field notes from the Moonfold team: how provider handoff works, release notes, and guides for running coding agents on your own machine.",
      canonical: "/blog/",
      bodyClass: "page-blog",
      active: "blog",
      main: index,
    }),
  );
  return posts.map((p) => `/blog/${p.slug}/`).concat("/blog/");
}

// ---------------------------------------------------------------------------

const urls = ["/", ...(await buildDocs()), ...(await buildBlog())];
await writeFile(
  path.join(root, "public", "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((u) => `<url><loc>${SITE}${u}</loc></url>`)
    .join("")}</urlset>\n`,
);
console.log(`Generated ${urls.length - 1} content pages and the sitemap.`);
