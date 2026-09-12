#!/usr/bin/env node
// Deterministic, offline build: ../behavioral_quotients.md -> index.html
//
// Pipeline
//   1. Pandoc reads the paper and emits an HTML5 fragment (--mathjax, so TeX is
//      passed through verbatim rather than being lossily converted to MathML).
//   2. Pandoc's own JSON AST is read as ground truth and INVENTORY.json is written.
//   3. The fragment is post-processed in the DOM: math gains data-tex and
//      MathJax delimiters, citation brackets become anchors, the reference list
//      gains ids and backlinks, headings gain anchor links, a TOC is derived.
//   4. The result is wrapped in the Distill page skeleton and written.
//
// No network access, no timestamps in index.html. Two runs are byte-identical.

import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

import { pandocJson, mathNodes, plainText, headings as astHeadings, normalizeText, sections, blocksText } from './lib/ast.mjs';
import { findCitations } from './lib/citations.mjs';
import { buildInventory } from './lib/inventory.mjs';
import {
  pandoc,
  squash,
  slugify,
  stableJson,
  sha256,
  MD_PATH,
  SITE_DIR,
  INDEX_PATH,
} from './lib/util.mjs';

const READER = 'markdown+tex_math_dollars+pipe_tables+smart';
const OUT_DIR = SITE_DIR;

// --- site metadata (SEO, hosting, analytics) -------------------------------
// Override the canonical URL at build time with BQ_SITE_URL when hosting
// somewhere other than the default GitHub Pages path.
const SITE = {
  url: process.env.BQ_SITE_URL || 'https://sethuiyer.github.io/behavioral-quotients/',
  date: '2026-09-12',
  author: 'Sethu Iyer',
  publisher: 'ShunyaBar Labs',
  publisherUrl: 'https://shunyabar.foo',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  keywords: [
    'behavioral quotient', 'state minimization', 'Myhill-Nerode', 'causal states',
    'bisimulation', 'natural gradient', 'Fisher-Rao metric', 'Morse theory',
    'sum of squares', 'Positivstellensatz', 'SAT', 'MaxSAT', 'KV cache',
    'context compression', 'mechanistic interpretability', 'AI alignment',
  ],
  tracker: { src: 'https://beampipe.io/js/tracker.js', domain: 'sethuiyer.github.io' },
  pdf: 'paper.pdf',
};
const absUrl = (p) => new URL(p, SITE.url).href;

const warnings = [];
const note = (m) => warnings.push(m);

// ---------------------------------------------------------------------------
// 1. Read the source
// ---------------------------------------------------------------------------

const rawMd = fs.readFileSync(MD_PATH, 'utf8');
const ast = pandocJson(MD_PATH);
fs.writeFileSync(path.join(OUT_DIR, 'INVENTORY.json'), stableJson(buildInventory(ast, rawMd)));

const pandocHtml = pandoc([
  MD_PATH,
  '-f',
  READER,
  '-t',
  'html5',
  '--mathjax',
  '--no-highlight',
]);

const { document: doc } = parseHTML(`<!doctype html><html><body>${pandocHtml}</body></html>`);
const body = doc.body;

// ---------------------------------------------------------------------------
// 2. Split off the front matter (title + subtitle) into the Distill header
// ---------------------------------------------------------------------------

const bodyChildren = Array.from(body.childNodes);
const firstElements = bodyChildren.filter((n) => n.nodeType === 1);

const titleEl = firstElements[0];
const subtitleEl = firstElements[1];
if (titleEl?.tagName !== 'H1' || subtitleEl?.tagName !== 'H3') {
  throw new Error('front matter layout changed: expected <h1> then <h3>');
}
// Pandoc wraps the <h1> in the document; keep the full rendered heading but
// demote it to <h1> semantics inside the header block.
titleEl.parentNode.removeChild(titleEl);
subtitleEl.parentNode.removeChild(subtitleEl);

// ---------------------------------------------------------------------------
// 3. Math: capture data-tex, normalise delimiters to MathJax's $ / $$
// ---------------------------------------------------------------------------

const mathSpans = Array.from(body.querySelectorAll('span.math'));
let inlineMath = 0;
let displayMath = 0;

for (const span of mathSpans) {
  const isDisplay = span.classList.contains('display');
  let tex = span.textContent;
  if (tex.startsWith('\\(') && tex.endsWith('\\)')) tex = tex.slice(2, -2);
  else if (tex.startsWith('\\[') && tex.endsWith('\\]')) tex = tex.slice(2, -2);
  else throw new Error(`unexpected math delimiters near: ${tex.slice(0, 60)}`);

  tex = squash(tex);
  span.setAttribute('data-tex', tex);
  span.setAttribute('data-display', isDisplay ? 'true' : 'false');
  span.setAttribute('class', 'math d-math ' + (isDisplay ? 'display' : 'inline'));
  // MathJax v3 is configured for $…$ / $$…$$; the raw TeX survives in data-tex.
  span.textContent = isDisplay ? `$$${tex}$$` : `$${tex}$`;
  if (isDisplay) displayMath++;
  else inlineMath++;
}

// Display equations are emitted by Pandoc as `<p><span class="math display">…`.
// Lift them into their own block element so they can be styled and numbered.
// Four of the paper's display equations sit inside a flowing sentence rather
// than on their own line. Those are left exactly where they are: lifting them
// out would reorder the prose. Only the standalone ones get a block wrapper.
let unwrapped = 0;
let embedded = 0;
for (const span of Array.from(body.querySelectorAll('span.math.display'))) {
  const p = span.parentNode;
  const strayText = Array.from(p?.childNodes ?? [])
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent)
    .join('')
    .trim();
  const standalone =
    p?.tagName === 'P' && p.children.length === 1 && p.children[0] === span && strayText === '';
  if (!standalone) {
    embedded++;
    continue;
  }
  const div = doc.createElement('div');
  div.setAttribute('class', 'd-equation');
  p.parentNode.insertBefore(div, p);
  div.appendChild(span);
  p.parentNode.removeChild(p);
  unwrapped++;
}
if (unwrapped + embedded !== displayMath) {
  note(
    `display math accounting: ${displayMath} spans, ${unwrapped} standalone, ${embedded} embedded`
  );
}

// ---------------------------------------------------------------------------
// 4. Citations: bracket text -> anchors (visible text preserved byte-for-byte)
// ---------------------------------------------------------------------------

const skipInCitations = (el) =>
  (el.tagName === 'SPAN' && el.classList.contains('math')) ||
  el.tagName === 'PRE' ||
  el.tagName === 'CODE' ||
  el.tagName === 'A';

function textNodes(root) {
  const out = [];
  (function rec(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1) {
        if (skipInCitations(child)) continue;
        rec(child);
      } else if (child.nodeType === 3) {
        out.push(child);
      }
    }
  })(root);
  return out;
}

// First-citation anchors, filled in as we go. Each reference gets an empty
// <span id="cite-N"> marker so that the backlink target always resolves.
const firstCite = new Map();
let citationCount = 0;

for (const tn of textNodes(body)) {
  const text = tn.textContent;
  if (!text.includes('[')) continue;
  const cits = findCitations(text);
  if (!cits.length) continue;

  const frag = doc.createElement('span');
  let cursor = 0;
  for (const c of cits) {
    if (c.index > cursor) {
      frag.appendChild(doc.createTextNode(text.slice(cursor, c.index)));
    }
    for (const ref of c.refs) {
      if (firstCite.has(ref)) continue;
      firstCite.set(ref, `cite-${ref}`);
      const marker = doc.createElement('span');
      marker.setAttribute('id', `cite-${ref}`);
      marker.setAttribute('class', 'd-cite-anchor');
      frag.appendChild(marker);
    }
    const a = doc.createElement('a');
    a.setAttribute('class', 'd-cite');
    a.setAttribute('href', `#ref-${c.refs[0]}`);
    a.setAttribute('data-refs', c.refs.join(','));
    a.textContent = c.token;
    frag.appendChild(a);
    cursor = c.index + c.token.length;
    citationCount++;
  }
  if (cursor < text.length) frag.appendChild(doc.createTextNode(text.slice(cursor)));

  tn.parentNode.insertBefore(frag, tn);
  tn.parentNode.removeChild(tn);
}

// ---------------------------------------------------------------------------
// 5. Reference list: ids + backlinks
// ---------------------------------------------------------------------------

function directLi(ol) {
  return Array.from(ol.children).filter((li) => li.tagName === 'LI');
}
const lists = Array.from(body.querySelectorAll('ol'));
if (!lists.length) throw new Error('no ordered list found for the reference list');
const refList = lists.reduce((a, b) => (directLi(a).length >= directLi(b).length ? a : b));

const refItems = directLi(refList);
if (refItems.length !== 194) throw new Error(`expected 194 references, found ${refItems.length}`);

refList.setAttribute('class', 'd-references');
refList.setAttribute('role', 'list');

const missingBacklink = [];
refItems.forEach((li, i) => {
  const n = i + 1;
  li.setAttribute('id', `ref-${n}`);
  li.setAttribute('class', 'd-ref');
  if (!firstCite.has(n)) missingBacklink.push(n);
  const back = doc.createElement('a');
  back.setAttribute('class', 'd-ref-back');
  back.setAttribute('href', `#cite-${n}`);
  back.setAttribute('aria-label', `Back to the first citation of reference ${n}`);
  // No text content: the visible arrow comes from CSS, so the DOM carries no
  // generated prose and the visible-text comparison stays exact.
  li.appendChild(back);
});
if (missingBacklink.length) {
  throw new Error(`references never cited: ${missingBacklink.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 6. Table of contents (from ## and ###), captured before anchor links are added
// ---------------------------------------------------------------------------

const contentHeadings = Array.from(body.querySelectorAll('h2, h3, h4'));
const tocEntries = contentHeadings
  .filter((h) => h.tagName === 'H2' || h.tagName === 'H3')
  .map((h) => ({
    level: h.tagName === 'H2' ? 2 : 3,
    id: h.id,
    text: normalizeText(h.textContent),
    html: h.innerHTML,
  }));

const tocHtml = tocEntries
  .map(
    (e) =>
      `<li class="d-toc-item d-toc-l${e.level}" data-target="${escapeAttr(e.id)}">` +
      `<a href="#${escapeAttr(e.id)}"><span class="d-toc-text">${e.html}</span></a></li>`
  )
  .join('\n');

// ---------------------------------------------------------------------------
// 7. Heading anchors (empty elements; the § glyph is a CSS ::after)
// ---------------------------------------------------------------------------

const usedIds = new Set();
for (const h of Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
  if (!h.id) h.id = slugify(h.textContent);
  if (usedIds.has(h.id)) h.id = `${h.id}-${usedIds.size}`;
  usedIds.add(h.id);
  const a = doc.createElement('a');
  a.setAttribute('class', 'd-anchor');
  a.setAttribute('href', `#${h.id}`);
  a.setAttribute('aria-label', `Permalink to “${normalizeText(h.textContent)}”`);
  h.appendChild(a);
}

// ---------------------------------------------------------------------------
// 8. Layout wrappers: lede, appendix
// ---------------------------------------------------------------------------

// The status note (blockquote) and the Contribution paragraph form the lede.
// Order in the source is preserved exactly; only a wrapper is introduced.
const front = Array.from(body.children);
if (front[0]?.tagName === 'BLOCKQUOTE' && front[1]?.tagName === 'P') {
  const lede = doc.createElement('div');
  lede.setAttribute('class', 'd-lede');
  front[0].parentNode.insertBefore(lede, front[0]);
  lede.appendChild(front[0]);
  lede.appendChild(front[1]);
} else {
  note('lede not detected: expected <blockquote> followed by <p>');
}

// Everything from "Appendix A" to the end is the appendix block.
const appendixHeads = Array.from(body.querySelectorAll('h2')).filter((h) =>
  /^Appendix\s+[A-Z]\./.test(normalizeText(h.textContent))
);
if (appendixHeads.length) {
  const section = doc.createElement('section');
  section.setAttribute('class', 'd-appendix');
  const start = appendixHeads[0];
  start.parentNode.insertBefore(section, start);
  let n = start;
  while (n) {
    const next = n.nextSibling;
    section.appendChild(n);
    n = next;
  }
} else {
  note('no "Appendix X." heading found; appendix block not wrapped');
}

// ---------------------------------------------------------------------------
// 9. Serialise and wrap in the page skeleton
// ---------------------------------------------------------------------------

const articleHtml = Array.from(body.childNodes)
  .filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()))
  .map((n) => (n.nodeType === 1 ? n.outerHTML : escapeHtml(n.textContent)))
  .join('\n');

const titleText = normalizeText(titleEl.textContent);
const subtitleText = normalizeText(subtitleEl.textContent);

// Reading time, computed from the article prose only.
const articleText = normalizeText(
  plainText({ blocks: ast.blocks }) // same source text, math elided
);
const wordCount = articleText.split(/\s+/).filter(Boolean).length;
const readingMinutes = Math.max(1, Math.round(wordCount / 220));

// Abstract for the meta description + structured data (metadata only; the
// visible article is untouched, so the 1:1 verifier is unaffected).
const abstractSection = sections(ast).find((s) => normalizeText(s.text) === 'Abstract');
const abstractText = abstractSection ? normalizeText(blocksText(abstractSection.blocks)) : subtitleText;
const description = clampText(abstractText, 158);

const jsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'ScholarlyArticle',
  headline: titleText,
  name: titleText,
  alternativeHeadline: subtitleText,
  author: { '@type': 'Person', name: SITE.author, url: 'https://github.com/sethuiyer' },
  publisher: { '@type': 'Organization', name: SITE.publisher, url: SITE.publisherUrl },
  datePublished: SITE.date,
  dateModified: SITE.date,
  abstract: abstractText,
  keywords: SITE.keywords,
  inLanguage: 'en',
  url: SITE.url,
  mainEntityOfPage: SITE.url,
  license: SITE.license,
  isAccessibleForFree: true,
  encoding: { '@type': 'MediaObject', contentUrl: absUrl(SITE.pdf), encodingFormat: 'application/pdf' },
}).replace(/</g, '\\u003c');

const page = renderPage({
  titleText,
  titleHtml: titleEl.innerHTML,
  subtitleText,
  subtitleHtml: subtitleEl.innerHTML,
  subtitleId: subtitleEl.id,
  titleId: titleEl.id,
  tocHtml,
  articleHtml,
  readingMinutes,
  wordCount,
  description,
  abstractText,
  jsonLd,
});

fs.writeFileSync(INDEX_PATH, page);

// --- sitemap, robots, GitHub Pages marker ----------------------------------
const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE.url}</loc>
    <lastmod>${SITE.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${absUrl(SITE.pdf)}</loc>
    <lastmod>${SITE.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
`;
fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), sitemapXml);
fs.writeFileSync(
  path.join(OUT_DIR, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${absUrl('sitemap.xml')}\n`
);
fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

// ---------------------------------------------------------------------------
// 10. Build metadata (kept out of index.html so the page stays reproducible)
// ---------------------------------------------------------------------------

const meta = {
  source: path.relative(SITE_DIR, MD_PATH),
  source_sha256: sha256(rawMd),
  index_sha256: sha256(page),
  pandoc: pandoc(['--version']).split('\n')[0],
  reader: READER,
  mathjax: JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'node_modules/mathjax/package.json'), 'utf8'))
    .version,
  counts: {
    headings: astHeadings(ast).length,
    inline_math: inlineMath,
    display_math: displayMath,
    citations_rewritten: citationCount,
    references: refItems.length,
    toc_entries: tocEntries.length,
  },
  warnings,
};
fs.writeFileSync(path.join(OUT_DIR, 'build-info.json'), stableJson(meta));

console.log(
  `built index.html: ${inlineMath} inline + ${displayMath} display equations, ` +
    `${citationCount} citations, ${refItems.length} references, ${tocEntries.length} TOC entries`
);
for (const w of warnings) console.warn('  warning: ' + w);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clampText(s, n) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

/** Locale-independent thousands separator. */
function groupDigits(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function renderPage(o) {
  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.titleText)}</title>
<meta name="generator" content="build.mjs — pandoc + MathJax v3">
<meta name="description" content="${escapeAttr(o.description)}">
<meta name="author" content="${escapeAttr(SITE.author)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="keywords" content="${escapeAttr(SITE.keywords.join(', '))}">
<link rel="canonical" href="${SITE.url}">
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<link rel="sitemap" type="application/xml" href="sitemap.xml">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1116" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${escapeAttr(SITE.publisher)}">
<meta property="og:title" content="${escapeAttr(o.titleText)}">
<meta property="og:description" content="${escapeAttr(o.description)}">
<meta property="og:url" content="${SITE.url}">
<meta property="og:image" content="${absUrl('assets/og-image.png')}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeAttr(o.titleText)}">
<meta property="og:locale" content="en">
<meta property="article:author" content="${escapeAttr(SITE.author)}">
<meta property="article:published_time" content="${SITE.date}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(o.titleText)}">
<meta name="twitter:description" content="${escapeAttr(o.description)}">
<meta name="twitter:image" content="${absUrl('assets/og-image.png')}">
<meta name="citation_title" content="${escapeAttr(o.titleText)}">
<meta name="citation_author" content="${escapeAttr(SITE.author)}">
<meta name="citation_publication_date" content="${SITE.date.replace(/-/g, '/')}">
<meta name="citation_abstract_html_url" content="${SITE.url}">
<meta name="citation_pdf_url" content="${absUrl(SITE.pdf)}">
<meta name="citation_language" content="en">
<script type="application/ld+json">${o.jsonLd}</script>
<link rel="stylesheet" href="assets/distill.css">
<script>
// Set the theme before first paint to avoid a flash of the wrong palette.
(function () {
  try {
    var t = localStorage.getItem('bq-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
</script>
<script src="assets/mathjax-config.js"></script>
<script defer src="vendor/mathjax/tex-chtml-full.js"></script>
<script defer src="assets/citations.js"></script>
<script defer src="assets/app.js"></script>
</head>
<body>
<a class="d-skip" href="#d-content">Skip to content</a>
<div class="d-progress" aria-hidden="true"><div class="d-progress-bar" id="d-progress-bar"></div></div>
<div class="d-layout">
<nav class="d-toc" id="d-toc" aria-label="Table of contents">
<p class="d-toc-heading">Contents</p>
<ol class="d-toc-list">
${o.tocHtml}
</ol>
</nav>
<main class="d-main" id="d-content">
<header class="d-title">
<h1 id="${escapeAttr(o.titleId)}">${o.titleHtml}</h1>
<h3 class="d-subtitle" id="${escapeAttr(o.subtitleId)}">${o.subtitleHtml}</h3>
<div class="d-byline">
<span class="d-reading-time">${o.readingMinutes} min read</span>
<span class="d-byline-sep" aria-hidden="true">·</span>
<span class="d-word-count">${groupDigits(o.wordCount)} words</span>
<button type="button" class="d-theme-toggle" id="d-theme-toggle" aria-label="Toggle colour scheme">
<span class="d-theme-icon" aria-hidden="true"></span>
</button>
</div>
</header>
<article class="d-article" id="d-article">
${o.articleHtml}
</article>
</main>
</div>
<script async defer src="${SITE.tracker.src}" data-beampipe-domain="${SITE.tracker.domain}"></script>
</body>
</html>
`;
}
