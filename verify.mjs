#!/usr/bin/env node
// The verifier: the 1:1 correspondence proof.
//
// Both sides of every comparison come from a real parser, never a regex:
//
//   markdown side   Pandoc's own JSON AST of ../behavioral_quotients.md
//   HTML side       parse5 parsing the built index.html
//
// Those are the *same two parsers* the build itself uses (Pandoc reads the
// markdown, and the build's output is ordinary HTML5), so no third
// interpretation of the source can sneak in. A drift in either direction — a
// dropped paragraph, a reworded sentence, a lost equation, a reordered
// citation — changes one side and not the other and fails a test.
//
// Tests T1–T11 are defined in the task brief; each writes its observed counts
// into verify-report.json. Exit status is 0 only when all eleven pass, and the
// last line printed is VERIFIED.
//
//   node verify.mjs            # human-readable summary, exit 0/1
//
// No network access. Reads only ../behavioral_quotients.md and ./index.html.

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';

import {
  pandocJson,
  headings as astHeadings,
  mathNodes,
  plainText,
  sections as astSections,
  blocksText,
  normalizeText,
  walk,
} from './lib/ast.mjs';
import { findCitations } from './lib/citations.mjs';
import { checkMath } from './lib/mathcheck.mjs';
import { MD_PATH, INDEX_PATH, SITE_DIR, squash, stableJson } from './lib/util.mjs';

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const page = fs.readFileSync(INDEX_PATH, 'utf8');
const doc = parse(page);
const ast = pandocJson(MD_PATH);

// ---------------------------------------------------------------------------
// parse5 helpers
// ---------------------------------------------------------------------------

const MATH_PH = '\u0000MATH\u0000';

const kids = (n) => n.childNodes || [];
const isText = (n) => n.nodeName === '#text';
const isEl = (n) => typeof n.tagName === 'string';
const attr = (n, k) => {
  const a = (n.attrs || []).find((x) => x.name === k);
  return a ? a.value : null;
};
const hasAttr = (n, k) => (n.attrs || []).some((x) => x.name === k);
const clsList = (n) => (attr(n, 'class') || '').split(/\s+/).filter(Boolean);
const hasCls = (n, c) => clsList(n).includes(c);
const isHeading = (n) => /^h[1-6]$/.test(n.tagName);

/** Depth-first search over element nodes only. */
function findAll(root, pred) {
  const out = [];
  (function rec(n) {
    for (const c of kids(n)) {
      if (!isEl(c)) continue;
      if (pred(c)) out.push(c);
      rec(c);
    }
  })(root);
  return out;
}

function byId(id) {
  return findAll(doc, (n) => attr(n, 'id') === id)[0] || null;
}

/** Raw concatenated text of every descendant text node (no elision). */
function rawText(node) {
  let s = '';
  for (const c of kids(node)) {
    if (isText(c)) s += c.value;
    else if (isEl(c)) s += rawText(c);
  }
  return s;
}

/**
 * Visible text of a subtree.
 *   math: 'placeholder' -> the MATH sentinel (aligns with the AST walker)
 *         'skip'        -> nothing
 *   code: true          -> verbatim text kept
 *         false         -> a single space
 * `skipClasses` prunes generated chrome (the byline).
 */
function visibleText(node, { math = 'placeholder', code = false } = {}) {
  const out = [];
  (function rec(n) {
    for (const c of kids(n)) {
      if (isText(c)) {
        out.push(c.value);
        continue;
      }
      if (!isEl(c)) continue;
      const t = c.tagName;
      if (t === 'script' || t === 'style' || t === 'noscript' || t === 'svg') continue;
      if (hasCls(c, 'd-byline')) continue;
      if (t === 'pre' || t === 'code') {
        if (code) out.push(rawText(c));
        else out.push(' ');
        continue;
      }
      if (t === 'span' && hasCls(c, 'math')) {
        if (math === 'placeholder') out.push(MATH_PH);
        else out.push(' ');
        continue;
      }
      rec(c);
    }
  })(node);
  return out.join('');
}

const norm = (s) => normalizeText(s);

// ---------------------------------------------------------------------------
// Sections, both sides
// ---------------------------------------------------------------------------

/**
 * Split `main#d-content` into sections at every heading, exactly as
 * `sections()` splits the Pandoc AST. Generated chrome inside the title block
 * (`.d-byline`, the theme button) is pruned; the `.d-lede` and `.d-appendix`
 * wrappers are transparent because the walk descends through every element.
 */
function htmlSections(root) {
  const secs = [];
  let cur = { level: 0, text: '', chunks: [] };
  const flush = () => secs.push({ level: cur.level, text: cur.text, body: norm(cur.chunks.join('')) });

  (function rec(n) {
    for (const c of kids(n)) {
      if (isText(c)) {
        cur.chunks.push(c.value);
        continue;
      }
      if (!isEl(c)) continue;
      const t = c.tagName;
      if (t === 'script' || t === 'style' || t === 'noscript' || t === 'button' || t === 'svg') continue;
      if (hasCls(c, 'd-byline')) continue;
      if (isHeading(c)) {
        flush();
        cur = { level: +t[1], text: norm(visibleText(c)), chunks: [] };
        continue;
      }
      if (t === 'pre' || t === 'code') {
        cur.chunks.push(' ');
        continue;
      }
      if (t === 'span' && hasCls(c, 'math')) {
        cur.chunks.push(MATH_PH);
        continue;
      }
      rec(c);
    }
  })(root);

  flush();
  return secs;
}

const mdSectionList = astSections(ast).map((s) => ({
  level: s.level,
  text: norm(s.text),
  body: norm(blocksText(s.blocks, { skipCode: true })),
}));

const main = byId('d-content');
const article = byId('d-article');
const htmlSectionList = main ? htmlSections(main) : [];

// ---------------------------------------------------------------------------
// Markdown-side extractions
// ---------------------------------------------------------------------------

function mdTableCells(tbl) {
  const c = tbl.c;
  const cells = [];
  const row = (r) => {
    for (const cell of r[1]) cells.push(norm(blocksText(cell[4], { skipCode: true })));
  };
  for (const r of c[3][1]) row(r); // header rows
  for (const body of c[4]) {
    for (const r of body[2]) row(r); // row-head rows
    for (const r of body[3]) row(r); // body rows
  }
  return cells;
}

const mdTables = [];
const mdCodeBlocks = [];
let mdRefCount = 0;
walk(ast, (n) => {
  if (n.t === 'Table') mdTables.push(n);
  else if (n.t === 'CodeBlock') {
    mdCodeBlocks.push({ lang: (n.c[0][1] || [])[0] || '', text: n.c[1] });
  } else if (n.t === 'OrderedList') {
    mdRefCount = Math.max(mdRefCount, n.c[1].length);
  }
});

const mdMath = mathNodes(ast);
const mdCitations = findCitations(plainText(ast, { skipCode: true })).map((c) => c.token);

// ---------------------------------------------------------------------------
// Comparison primitives
// ---------------------------------------------------------------------------

function countBy(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

/** Multiset difference; returns the entries that differ, with their counts. */
function multisetDiff(a, b) {
  const ca = countBy(a);
  const cb = countBy(b);
  const onlyMd = [];
  const onlyHtml = [];
  for (const k of new Set([...ca.keys(), ...cb.keys()])) {
    const d = (ca.get(k) || 0) - (cb.get(k) || 0);
    if (d > 0) onlyMd.push({ n: d, value: k });
    else if (d < 0) onlyHtml.push({ n: -d, value: k });
  }
  return { onlyMd, onlyHtml };
}

function firstDiffIndex(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** A short, symmetric window around a differing element. */
function contextAround(list, i, radius = 2) {
  return list.slice(Math.max(0, i - radius), i + radius + 1).map((x) => String(x).slice(0, 120));
}

function snippet(s, max = 160) {
  const t = String(s);
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function fmtMultiset(entries, max = 5) {
  const shown = entries.slice(0, max).map((e) => `${e.n}× ${snippet(e.value, 90)}`);
  if (entries.length > max) shown.push(`… and ${entries.length - max} more`);
  return shown;
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const results = [];

function test(id, name, fn) {
  let r;
  try {
    r = fn();
  } catch (e) {
    r = { ok: false, detail: `threw ${e?.message ?? e}`, observed: null };
  }
  results.push({ id, name, ok: r.ok, detail: r.detail, observed: r.observed ?? null });
  return r;
}

// --- T1: headings ----------------------------------------------------------

test('T1', 'headings', () => {
  const md = astHeadings(ast).map((h) => ({ level: h.level, text: norm(h.text) }));
  const html = findAll(main, isHeading).map((h) => ({ level: +h.tagName[1], text: norm(visibleText(h)) }));
  const observed = { markdown: md.length, html: html.length };

  const mdKeys = md.map((h) => `h${h.level}\t${h.text}`);
  const htmlKeys = html.map((h) => `h${h.level}\t${h.text}`);
  const ok = md.length === html.length && mdKeys.every((k, i) => k === htmlKeys[i]);
  if (ok) return { ok: true, detail: `${md.length} headings, level and text identical in order`, observed };

  const i = firstDiffIndex(mdKeys, htmlKeys);
  const { onlyMd, onlyHtml } = multisetDiff(mdKeys, htmlKeys);
  return {
    ok: false,
    detail:
      `heading sequences differ from index ${i}\n` +
      `        markdown: ${mdKeys.slice(Math.max(0, i - 1), i + 2).map(snippet).join(' | ')}\n` +
      `        html:     ${htmlKeys.slice(Math.max(0, i - 1), i + 2).map(snippet).join(' | ')}\n` +
      `        only in markdown: ${fmtMultiset(onlyMd).join('; ') || '—'}\n` +
      `        only in html:     ${fmtMultiset(onlyHtml).join('; ') || '—'}`,
    observed,
  };
});

// --- T2 / T3: display and inline math --------------------------------------

function mathTest(kind, label) {
  return () => {
    const md = (kind === 'display' ? mdMath.display : mdMath.inline).map(squash);
    const html = findAll(article, (n) => hasAttr(n, 'data-tex'))
      .filter((n) => (attr(n, 'data-display') === 'true') === (kind === 'display'))
      .map((n) => squash(attr(n, 'data-tex')));

    const observed = { markdown: md.length, html: html.length };
    // The brief asks for equal multisets. Comparing in document order proves
    // strictly more — equal multisets *and* equal order — so that is what is
    // asserted; a reordering is then reported as a reordering, not as a lost
    // equation.
    if (md.length === html.length && md.every((t, i) => t === html[i])) {
      return { ok: true, detail: `${md.length} ${label} equations, TeX identical in document order`, observed };
    }

    const i = firstDiffIndex(md, html);
    const { onlyMd, onlyHtml } = multisetDiff(md, html);
    const sameSet = onlyMd.length === 0 && onlyHtml.length === 0;
    const head = sameSet
      ? `${label} equations are all present but out of order (first divergence at index ${i})`
      : `${label} equations differ (markdown ${md.length}, html ${html.length})`;
    return {
      ok: false,
      detail:
        `${head}\n` +
        `        markdown: ${contextAround(md, i).map((s) => snippet(s, 70)).join(' | ')}\n` +
        `        html:     ${contextAround(html, i).map((s) => snippet(s, 70)).join(' | ')}` +
        (sameSet
          ? ''
          : `\n        only in markdown:\n          ${fmtMultiset(onlyMd).join('\n          ') || '—'}\n` +
            `        only in html:\n          ${fmtMultiset(onlyHtml).join('\n          ') || '—'}`),
      observed,
    };
  };
}

test('T2', 'display math', mathTest('display', 'display'));
test('T3', 'inline math', mathTest('inline', 'inline'));

// --- T3b: no equation may exist only in the table of contents --------------

test('T2b', 'math containment (TOC ⊆ article)', () => {
  const toc = byId('d-toc');
  const tocMath = toc
    ? findAll(toc, (n) => hasAttr(n, 'data-tex')).map((n) => squash(attr(n, 'data-tex')))
    : [];
  const articleMath = findAll(article, (n) => hasAttr(n, 'data-tex')).map((n) => squash(attr(n, 'data-tex')));
  const allMath = findAll(doc, (n) => hasAttr(n, 'data-tex')).map((n) => squash(attr(n, 'data-tex')));

  const observed = { article: articleMath.length, toc: tocMath.length, page: allMath.length };
  const { onlyHtml } = multisetDiff(articleMath.concat(tocMath), allMath);
  const { onlyHtml: tocOnly } = multisetDiff(articleMath, tocMath);
  const ok = onlyHtml.length === 0 && tocOnly.length === 0;
  if (ok) {
    return {
      ok: true,
      detail: `page math (${allMath.length}) = article (${articleMath.length}) + TOC (${tocMath.length}); TOC copies are already in the article`,
      observed,
    };
  }
  return {
    ok: false,
    detail:
      `equations outside the article:\n          ${fmtMultiset(onlyHtml).join('\n          ') || '—'}\n` +
      `        TOC-only equations:\n          ${fmtMultiset(tocOnly).join('\n          ') || '—'}`,
    observed,
  };
});

// --- T4: citations ---------------------------------------------------------

test('T4', 'citations', () => {
  const html = findAll(article, (n) => n.tagName === 'a' && hasCls(n, 'd-cite')).map((a) => rawText(a).trim());
  const observed = { markdown: mdCitations.length, html: html.length, distinct: new Set(mdCitations).size };

  const ok = mdCitations.length === html.length && mdCitations.every((t, i) => t === html[i]);
  if (ok) return { ok: true, detail: `${mdCitations.length} citation tokens identical in order`, observed };

  const i = firstDiffIndex(mdCitations, html);
  return {
    ok: false,
    detail:
      `citation sequence differs from index ${i} (markdown ${mdCitations.length}, html ${html.length})\n` +
      `        markdown: ${contextAround(mdCitations, i).map(JSON.stringify).join(' ')}\n` +
      `        html:     ${contextAround(html, i).map(JSON.stringify).join(' ')}`,
    observed,
  };
});

// --- T5: tables ------------------------------------------------------------

test('T5', 'tables', () => {
  const htmlTables = findAll(article, (n) => n.tagName === 'table');
  const observed = { markdown: mdTables.length, html: htmlTables.length, cells: [] };

  if (mdTables.length !== htmlTables.length) {
    return {
      ok: false,
      detail: `table count differs: markdown ${mdTables.length}, html ${htmlTables.length}`,
      observed,
    };
  }

  for (let i = 0; i < mdTables.length; i++) {
    const mdCells = mdTableCells(mdTables[i]);
    const htmlCells = findAll(htmlTables[i], (n) => n.tagName === 'th' || n.tagName === 'td').map((c) =>
      norm(visibleText(c))
    );
    observed.cells.push({ table: i + 1, markdown: mdCells.length, html: htmlCells.length });

    if (mdCells.length !== htmlCells.length) {
      return {
        ok: false,
        detail: `table ${i + 1}: cell count differs (markdown ${mdCells.length}, html ${htmlCells.length})`,
        observed,
      };
    }
    const { onlyMd, onlyHtml } = multisetDiff(mdCells, htmlCells);
    if (onlyMd.length || onlyHtml.length) {
      return {
        ok: false,
        detail:
          `table ${i + 1}: cell text differs\n` +
          `        only in markdown: ${fmtMultiset(onlyMd).join('; ') || '—'}\n` +
          `        only in html:     ${fmtMultiset(onlyHtml).join('; ') || '—'}`,
        observed,
      };
    }
  }
  const total = observed.cells.reduce((a, c) => a + c.markdown, 0);
  return {
    ok: true,
    detail: `${mdTables.length} tables, ${total} cells, per-table cell multisets identical`,
    observed,
  };
});

// --- T6: code fences -------------------------------------------------------

test('T6', 'code blocks', () => {
  const htmlCode = findAll(article, (n) => n.tagName === 'code' && n.parentNode?.tagName === 'pre');
  const observed = { markdown: mdCodeBlocks.length, html: htmlCode.length };

  if (mdCodeBlocks.length !== htmlCode.length) {
    return { ok: false, detail: `code block count differs (markdown ${mdCodeBlocks.length}, html ${htmlCode.length})`, observed };
  }
  for (let i = 0; i < mdCodeBlocks.length; i++) {
    const htmlLang = clsList(htmlCode[i]).find((c) => c.startsWith('language-')) || '';
    const htmlBody = rawText(htmlCode[i]).replace(/\n$/, '');
    const mdBody = mdCodeBlocks[i].text.replace(/\n$/, '');
    observed[`block_${i + 1}`] = { language: mdCodeBlocks[i].lang || '(none)', bytes: mdBody.length };
    if (mdCodeBlocks[i].lang !== htmlLang.replace(/^language-/, '')) {
      return {
        ok: false,
        detail: `code block ${i + 1}: language differs (markdown ${JSON.stringify(mdCodeBlocks[i].lang)}, html ${JSON.stringify(htmlLang)})`,
        observed,
      };
    }
    if (mdBody !== htmlBody) {
      const j = firstDiffIndex([...mdBody], [...htmlBody]);
      return {
        ok: false,
        detail:
          `code block ${i + 1}: body differs at byte ${j}\n` +
          `        markdown: ${JSON.stringify(mdBody.slice(Math.max(0, j - 40), j + 40))}\n` +
          `        html:     ${JSON.stringify(htmlBody.slice(Math.max(0, j - 40), j + 40))}`,
        observed,
      };
    }
  }
  return { ok: true, detail: `${mdCodeBlocks.length} code block(s), language and body byte-identical`, observed };
});

// --- T7: references --------------------------------------------------------

test('T7', 'references', () => {
  const refs = findAll(article, (n) => n.tagName === 'li' && hasCls(n, 'd-ref'));
  const ids = new Set(findAll(doc, (n) => hasAttr(n, 'id')).map((n) => attr(n, 'id')));
  const observed = { markdown: mdRefCount, html: refs.length, cite_markers: [...ids].filter((i) => /^cite-\d+$/.test(i)).length };

  if (refs.length !== mdRefCount) {
    return { ok: false, detail: `reference count differs (markdown ${mdRefCount}, html ${refs.length})`, observed };
  }

  const problems = [];
  refs.forEach((li, i) => {
    const n = i + 1;
    if (attr(li, 'id') !== `ref-${n}`) problems.push(`item ${n} has id ${JSON.stringify(attr(li, 'id'))}`);
    const back = findAll(li, (a) => a.tagName === 'a' && hasCls(a, 'd-ref-back'))[0];
    if (!back) problems.push(`reference ${n} has no backlink`);
    else if (attr(back, 'href') !== `#cite-${n}`) problems.push(`reference ${n} backlink -> ${attr(back, 'href')}`);
    if (!ids.has(`cite-${n}`)) problems.push(`reference ${n} is never cited (no #cite-${n} marker)`);
  });

  if (problems.length) {
    return { ok: false, detail: `${problems.length} reference problem(s):\n        ${problems.slice(0, 10).join('\n        ')}`, observed };
  }
  return {
    ok: true,
    detail: `${refs.length} references, ids ref-1..ref-${refs.length} in order, every one cited and backlinked`,
    observed,
  };
});

// --- T8: section text ------------------------------------------------------

test('T8', 'section text', () => {
  const observed = { markdown: mdSectionList.length, html: htmlSectionList.length, mismatches: [] };

  if (mdSectionList.length !== htmlSectionList.length) {
    return {
      ok: false,
      detail: `section count differs (markdown ${mdSectionList.length}, html ${htmlSectionList.length})`,
      observed,
    };
  }

  for (let i = 0; i < mdSectionList.length; i++) {
    const a = mdSectionList[i];
    const b = htmlSectionList[i];
    if (a.level !== b.level) {
      observed.mismatches.push(i);
      return { ok: false, detail: `section ${i}: level differs (markdown h${a.level}, html h${b.level})`, observed };
    }
    if (a.text !== b.text) {
      observed.mismatches.push(i);
      const j = firstDiffIndex([...a.text], [...b.text]);
      return {
        ok: false,
        detail:
          `section ${i} (h${a.level}) heading text differs at char ${j}\n` +
          `        markdown: ${JSON.stringify(a.text.slice(Math.max(0, j - 50), j + 50))}\n` +
          `        html:     ${JSON.stringify(b.text.slice(Math.max(0, j - 50), j + 50))}`,
        observed,
      };
    }
    if (a.body !== b.body) {
      observed.mismatches.push(i);
      const j = firstDiffIndex([...a.body], [...b.body]);
      return {
        ok: false,
        detail:
          `section ${i} ("${snippet(a.text, 60)}") body differs at char ${j} ` +
          `(markdown ${a.body.length}, html ${b.body.length})\n` +
          `        markdown: ${JSON.stringify(a.body.slice(Math.max(0, j - 60), j + 60))}\n` +
          `        html:     ${JSON.stringify(b.body.slice(Math.max(0, j - 60), j + 60))}`,
        observed,
      };
    }
  }

  const chars = mdSectionList.reduce((s, x) => s + x.body.length, 0);
  return { ok: true, detail: `${mdSectionList.length} sections, ${chars} normalized chars, byte-identical`, observed };
});

// --- T9: math typesetting --------------------------------------------------

test('T9', 'math typesetting', () => {
  const report = checkMath(page);
  const observed = {
    equations: report.equations,
    in_article: report.equations_in_article,
    in_toc: report.equations_in_toc,
    inline: report.inline,
    display: report.display,
    typeset_ok: report.typeset_ok,
    errors: report.errors,
  };

  const bad = /<m(?:jx-)?error\b/.exec(page);
  if (report.errors || bad) {
    const first = report.failures[0];
    return {
      ok: false,
      detail:
        `${report.errors} MathJax error(s) over ${report.equations} equations` +
        (first ? `\n        first: [${first.display ? 'display' : 'inline'}/${first.where}] ${snippet(first.tex)}\n          -> ${first.error}` : '') +
        (bad ? `\n        a merror element is present in index.html` : ''),
      observed,
    };
  }
  return {
    ok: true,
    detail: `${report.equations} equations typeset with 0 errors (${report.equations_in_article} article, ${report.equations_in_toc} TOC)`,
    observed,
  };
});

// --- T10: no markdown / TeX leakage into the prose -------------------------

test('T10', 'no source leakage', () => {
  const leaks = [];
  const record = (kind, value, where) => leaks.push({ kind, value: snippet(value, 70), where });

  (function scan(n, inside) {
    for (const c of kids(n)) {
      if (isText(c)) {
        if (inside) continue;
        const v = c.value;
        const delim = v.match(/\\[()[\]]/g);
        if (delim) record('tex delimiter', delim.join(''), snippet(v, 60));
        const dollar = v.match(/\$/g);
        if (dollar) record('dollar sign', dollar.join(''), snippet(v, 60));
        const cmd = v.match(/\\[A-Za-z]+/g);
        if (cmd) record('tex command', cmd.join(' '), snippet(v, 60));
        continue;
      }
      if (!isEl(c)) continue;
      const t = c.tagName;
      const now =
        inside ||
        t === 'pre' ||
        t === 'code' ||
        t === 'script' ||
        t === 'style' ||
        (t === 'span' && hasCls(c, 'math'));
      scan(c, now);
    }
  })(doc, false);

  // Every equation element must carry its TeX so it can be re-checked later.
  const unannotated = findAll(article, (n) => n.tagName === 'span' && hasCls(n, 'math') && !hasAttr(n, 'data-tex'));

  // Runtime must not depend on the network, with one audited exception: the
  // analytics tracker, which is async/defer and must not affect rendering.
  // Only true subresource relations count: <link rel="canonical">, rel="sitemap"
  // and rel="alternate"> are metadata pointing at this document, not fetches.
  const SUBRESOURCE_REL = new Set([
    'stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon', 'mask-icon',
    'preload', 'prefetch', 'modulepreload', 'manifest',
  ]);
  const ALLOWED_REMOTE = ['https://beampipe.io/js/tracker.js'];
  const remote = [];
  const remoteAllowed = [];
  for (const el of findAll(doc, (n) => ['script', 'link', 'img', 'source'].includes(n.tagName))) {
    if (el.tagName === 'link') {
      const rel = (attr(el, 'rel') || '').toLowerCase();
      if (!SUBRESOURCE_REL.has(rel)) continue;
    }
    const url = el.tagName === 'link' ? attr(el, 'href') : attr(el, 'src');
    if (url && /^(https?:)?\/\//.test(url)) {
      if (ALLOWED_REMOTE.includes(url)) remoteAllowed.push(`${el.tagName} ${url}`);
      else remote.push(`${el.tagName} ${url}`);
    }
  }

  const observed = {
    leaks: leaks.length,
    unannotated_math: unannotated.length,
    remote_subresources: remote.length,
    remote_allowed: remoteAllowed.length,
    sample: leaks.slice(0, 8),
  };

  if (leaks.length || unannotated.length || remote.length) {
    const parts = [];
    if (leaks.length) {
      parts.push(
        `${leaks.length} leaked token(s):\n` +
          leaks.slice(0, 8).map((l) => `          [${l.kind}] ${l.value}  ← in ${JSON.stringify(l.where)}`).join('\n')
      );
    }
    if (unannotated.length) parts.push(`${unannotated.length} math span(s) without data-tex`);
    if (remote.length) parts.push(`${remote.length} remote subresource(s): ${remote.join(', ')}`);
    return { ok: false, detail: parts.join('\n        '), observed };
  }
  return {
    ok: true,
    detail: `no TeX delimiters, $ signs or \\commands in prose; all math annotated; 0 unaudited remote subresources (${remoteAllowed.length} audited tracker allowed)`,
    observed,
  };
});

// --- T11: internal anchors resolve -----------------------------------------

test('T11', 'anchors resolve', () => {
  const withId = findAll(doc, (n) => hasAttr(n, 'id'));
  const ids = new Set();
  const dupes = [];
  for (const el of withId) {
    const id = attr(el, 'id');
    if (ids.has(id)) dupes.push(id);
    ids.add(id);
  }

  const dangling = [];
  let checked = 0;
  for (const el of findAll(doc, (n) => hasAttr(n, 'href') || hasAttr(n, 'data-target'))) {
    for (const key of ['href', 'data-target']) {
      const v = attr(el, key);
      if (!v) continue;
      const target = key === 'href' ? (v.startsWith('#') ? v.slice(1) : null) : v;
      if (target === null) continue;
      checked++;
      if (target && !ids.has(target)) dangling.push(`${key}="${v}" on <${el.tagName}${hasCls(el, 'd-cite') ? ' class="d-cite"' : ''}>`);
    }
  }

  const observed = { ids: ids.size, internal_links: checked, dangling: dangling.length, duplicates: dupes.length };
  if (dangling.length || dupes.length) {
    return {
      ok: false,
      detail:
        (dangling.length ? `${dangling.length} dangling anchor(s):\n        ${dangling.slice(0, 10).join('\n        ')}\n` : '') +
        (dupes.length ? `duplicate id(s): ${dupes.slice(0, 10).join(', ')}` : ''),
      observed,
    };
  }
  return { ok: true, detail: `${checked} internal links resolve across ${ids.size} unique ids`, observed };
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const label = (r) => `${r.id}  ${r.name}`.padEnd(34);
console.log('');
for (const r of results) {
  console.log(`${label(r)} ${r.ok ? 'PASS' : 'FAIL'}  ${r.detail.split('\n')[0]}`);
  if (!r.ok && r.detail.includes('\n')) {
    for (const line of r.detail.split('\n').slice(1)) console.log(line);
  }
}

const failures = results.filter((r) => !r.ok);
const report = {
  source: path.relative(SITE_DIR, MD_PATH),
  index: path.relative(SITE_DIR, INDEX_PATH),
  generated_by: 'verify.mjs',
  passed: results.length - failures.length,
  failed: failures.length,
  tests: results.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.ok ? 'pass' : 'fail',
    detail: r.detail,
    observed: r.observed,
  })),
};
fs.writeFileSync(path.join(SITE_DIR, 'verify-report.json'), stableJson(report));

console.log('');
console.log(`${report.passed}/${results.length} tests passed → verify-report.json`);

if (failures.length) {
  console.log(`FAILED: ${failures.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log('VERIFIED');
