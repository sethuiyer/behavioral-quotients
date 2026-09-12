# `behavioral_quotients` — Distill-style site with a mechanical 1:1 proof

[![verify-and-deploy](https://github.com/sethuiyer/behavioral-quotients/actions/workflows/verify-and-deploy.yml/badge.svg)](https://github.com/sethuiyer/behavioral-quotients/actions/workflows/verify-and-deploy.yml)
[![live](https://img.shields.io/badge/live-sethuiyer.github.io%2Fbehavioral--quotients-7aa2f7)](https://sethuiyer.github.io/behavioral-quotients/)

A static, offline, framework-free rendering of `behavioral_quotients.md`, plus a
verifier that *proves* the page corresponds to the paper 1:1 — nothing added,
nothing dropped, nothing reordered, nothing reworded.

The page is **derived, never authored**. `behavioral_quotients.md` is the single
source of truth and is never written to. Everything under `site/` except the
hand-written assets (`lib/`, `build.mjs`, `verify.mjs`, `assets/*`, `build.sh`,
this file) is generated.

## Continuous verification

`.github/workflows/verify-and-deploy.yml` runs on every push and pull request and
is a **deployment gate**: the `deploy` job depends on `verify`, so a page whose
1:1 correspondence has drifted is never published.

Pipeline: pinned Pandoc 3.1.13 → `npm ci` → `./build.sh` (which itself proves
determinism) → `node check-math.mjs` → `node verify.mjs` → `./publish.sh` →
`actions/deploy-pages`. The verification reports are uploaded as a build artifact
and `verify-report.json` is served alongside the page.

## Quick start

```bash
cd site
npm ci                 # once; the only step that needs the network
./build.sh             # builds index.html, then proves the build is deterministic
node check-math.mjs    # 0 errors over 500 equations
node verify.mjs        # VERIFIED
./publish.sh           # assemble _site/ (what CI deploys)
```

`./build.sh && node verify.mjs` is the acceptance command. `verify.mjs` exits
non-zero on the first sign of drift and prints the mismatch with context on both
sides.

## Environment

| Tool | Version used |
|---|---|
| pandoc | 3.1.13 |
| node | 22.23.2 (any ≥ 18 should work) |
| MathJax | 3.2.2, vendored under `vendor/mathjax/` (25 files, 1.7 MB) |
| parse5 | 8.0.1 (verifier) |
| linkedom | 0.18.13 (build) |
| mathjax-full | 3.2.2 (headless TeX typesetting for T9 / `check-math.mjs`) |

**Offline at runtime.** `index.html` references only `assets/*` and
`vendor/mathjax/*`; there is no CDN, no `<script src="https://…">`, no web font.
T10 asserts this. The build itself does not touch the network either.

**No frameworks.** Vanilla HTML, CSS and `defer`-loaded ES5-compatible JS. The
only JavaScript dependencies are build- and verify-time.

## Pipeline

```
behavioral_quotients.md
   │
   ├─ pandoc -f markdown+tex_math_dollars+pipe_tables+smart -t json
   │     └─ Pandoc's own AST ──────────────► INVENTORY.json      (measured ground truth)
   │
   └─ pandoc -f … -t html5 --mathjax --no-highlight
         │
         └─ linkedom post-processing ──────► index.html
              1. front matter (h1 + h3) lifted into the Distill title block
              2. every <span class="math"> gains data-tex / data-display and is
                 rewritten to MathJax's $…$ / $$…$$ (raw TeX preserved in data-tex)
              3. standalone display equations are lifted into <div class="d-equation">
              4. citation brackets become <a class="d-cite" href="#ref-N" data-refs="…">
              5. the reference <ol> gains ids, roles and empty backlink anchors
              6. the TOC is derived from ## and ###
              7. headings gain an empty <a class="d-anchor">
              8. the lede and the appendix are wrapped
         │
         └─ wrapped in the Distill page skeleton ──► index.html
                                                     build-info.json  (metadata, no clock)
```

Two flags matter:

- **`--mathjax`** is mandatory. Without it Pandoc converts TeX to MathML, which is
  lossy for this paper (`\varprojlim`, `\boxed`, `\tfrac` all warn and degrade).
  With it, the TeX survives verbatim into `data-tex` and MathJax does the typesetting.
- **`+smart`** is Pandoc's default for `markdown` and is kept on. Build and verifier
  read the source through the same reader, so typographic transforms (curly quotes,
  en-dashes) cannot drift between the two sides.

Both parsers in the verifier — Pandoc's reader for the markdown, parse5 for the HTML —
are the same parsers that produced the page in the first place. There is no
hand-rolled markdown regex anywhere in the pipeline.

## Files

| Path | Role |
|---|---|
| `index.html` | the page (generated) |
| `assets/distill.css` | all styling, light/dark, print, responsive |
| `assets/mathjax-config.js` | MathJax v3 config (delimiters, packages, tags) |
| `assets/citations.js` | hover/focus reference tooltips, read from `#ref-N` in the page |
| `assets/app.js` | theme toggle, reading-progress bar, TOC highlighting, permalink copy |
| `vendor/mathjax/` | MathJax 3.2.2 `tex-chtml-full.js` + woff-v2 fonts |
| `build.mjs` | the build |
| `build.sh` | preconditions + build + determinism proof |
| `verify.mjs` | the 11-test verifier |
| `check-math.mjs` | standalone MathJax gate |
| `lib/ast.mjs` | Pandoc AST walkers and the shared text normaliser |
| `lib/citations.mjs` | the citation grammar, shared by build and verifier |
| `lib/inventory.mjs` | `INVENTORY.json` |
| `lib/mathcheck.mjs` | headless MathJax typesetting, shared by `check-math.mjs` and T9 |
| `lib/util.mjs` | paths, `pandoc()`, `squash()`, `stableJson()`, `sha256()` |
| `INVENTORY.json` | measured ground truth (generated) |
| `verify-report.json` | per-test results with observed counts (generated) |
| `build-info.json` | source/index hashes, tool versions, warnings (generated) |
| `math-report.json` | equation census and any typesetting failures (generated) |

## The verifier

Run `node verify.mjs`. Each test compares the Pandoc AST of
`behavioral_quotients.md` against parse5's parse of the built `index.html`, and
writes what it saw to `verify-report.json`.

| # | Test | What it proves | Observed |
|---|---|---|---|
| T1 | headings | 40 headings, level and text identical, in order | 40 (h1×1, h2×17, h3×19, h4×3) |
| T2 | display math | TeX identical in document order | 28 |
| T3 | inline math | TeX identical in document order | 470 |
| T2b | math containment | page math = article math + TOC math, and TOC ⊆ article | 500 = 498 + 2 |
| T4 | citations | citation tokens identical, in order | 341 |
| T5 | tables | table count and per-table cell multisets identical | 9 tables, 335 cells |
| T6 | code blocks | count, language and body byte-identical | 1 block (no language) |
| T7 | references | `ref-1…ref-194` in order; every one cited and backlinked | 194 |
| T8 | section text | per-section visible text byte-identical after normalisation | 41 sections, 86 405 chars |
| T9 | math typesetting | every equation typesets through MathJax v3 with no `merror` | 500 equations, 0 errors |
| T10 | source leakage | no `\(`, `\)`, `\[`, `\]`, `$` or `\command` in prose; all math annotated; no remote subresources | 0 / 0 / 0 |
| T11 | anchors | every internal link and `data-target` resolves; ids unique | 644 links over 433 ids |

T2b is an extra guard beyond the brief. The table of contents legitimately repeats
two headings that contain math (§5.5 `\Rightarrow`, §7.1 `\varepsilon`), which is
why the page holds 500 equation elements while the article holds 498. T2b pins that
accounting down and makes it impossible for an equation to exist *only* in the TOC.

The brief specifies T2/T3 as multiset comparisons. The implementation compares in
document order, which implies equal multisets and additionally catches a pure
reordering; a reordering is reported as a reordering rather than as a lost equation.

### How the two sides are made comparable

- **Math** is compared through `data-tex`, not through rendered output, so the
  comparison is on the TeX the author wrote.
- **Section text** (T8) elides math and verbatim code on both sides and then collapses
  whitespace. Adjacent *blocks* are joined with a single space on the AST side
  because Pandoc's HTML writer puts each block in its own element, so the browser
  sees whitespace there; without that rule the two extractions differ by exactly one
  space at every paragraph boundary.
- **Smart punctuation**: Pandoc's `smart` extension represents `"…"` as a `Quoted`
  node whose marks live in the node discriminant, so `lib/ast.mjs` re-emits the
  curly glyphs the HTML writer emits.
- **Variation selectors**: Pandoc's HTML writer appends U+FE0E to glyphs such as `↔`
  to request text presentation; the AST carries the bare codepoint. `normalizeText`
  strips U+FE0E/U+FE0F. It touches no letter, digit, space or punctuation mark.
- **Generated chrome carries no DOM text.** The heading `§` and the reference `↩`
  are CSS `::after` content; the citation markers and backlinks are empty elements.
  The only generated visible text is the byline ("N min read · N words"), which the
  section walker skips explicitly. This is why no "ignore the chrome" escape hatch
  is needed in the comparisons.

## Inventory and discrepancies with the dispatch brief

`INVENTORY.json` records both what was measured from the AST (`totals`) and what the
dispatch brief stated (`dispatched_totals`). Nothing is silently reconciled: where
they differ, the difference is explained here.

| Quantity | Brief | Measured | Explanation |
|---|---|---|---|
| headings | 40 | **40** | agree — h1×1, h2×17, h3×19, h4×3 |
| display math | 28 | **28** | agree |
| inline math | 467 | **470** | The brief's regex missed three inline spans that span a source line break (`\mathrm{CSP}(\mathcal C)\in \mathrm P`, `\max_{\lambda\in[\mu,L]}\lvert p_t^\star(\lambda)\rvert\le…`, `\tfrac{d}{dt}\tfrac12\lVert x-x_m\rVert^2=…`). Pandoc's AST counts them. |
| table rows | 109 | **100** data rows | The brief counted every source line beginning with `\|`, which includes one `\|---\|` separator row per table. 100 data rows + 9 separators = 109. |
| code fences | 2 | **2** fence lines = **1** block | agree once "fence lines" and "code blocks" are distinguished; the block has no language tag |
| citations | 339 | **341** tokens | The brief counted pure-numeric tokens, which both included three `[0,1]`-style intervals that are *math*, not citations, and excluded the two descriptor forms `[40, Schaefer]` and `[61, Section 6.3]` and the three en-dash ranges. Split: 336 numeric-only + 3 ranges + 2 descriptors = 341. All resolve to references in 1…194. |
| references | 194 | **194** | agree; every one is cited at least once (`references_never_cited: []`) |
| distinct TeX commands | 119 | **119** | agree exactly, and the sorted list in `INVENTORY.json` (`totals.tex_commands`) diffs clean against the brief. A further 9 symbol/escape tokens (`\ `, `\!`, `\#`, `\%`, `\,`, `\\`, `\{`, `\|`, `\}`) are counted separately as `distinct_tex_tokens` = 128. |

## Residual limits — what is *not* proven

Stated plainly so the claim is not read as stronger than it is:

- **Order is compared per section, not per sentence.** T8 proves each section's text
  is byte-identical after normalisation; it does not prove two sentences *within* a
  paragraph were not swapped. In practice a swap would almost always change the
  normalised text, because prose and math interleave.
- **Math order is compared per kind** (all display equations in order, then all
  inline equations in order), not as one interleaved document sequence. An inline
  equation and a display equation exchanging places while both stay inside the same
  kind's sequence would not be caught by T2/T3 alone; T8's positional text
  comparison constrains it.
- **Whitespace is not compared.** T8 collapses runs of whitespace, so a line-break
  change in the source that does not change the rendered text would pass. This is
  deliberate: line wrapping is not part of what a reader sees.
- **Rendered glyphs are not compared.** T9 proves each equation *typesets without
  error*; it does not prove the typeset output matches some reference image.
- **The verifier trusts Pandoc's reader.** If Pandoc misparsed the markdown, both
  sides would be wrong in the same way. The defence is that Pandoc is the same tool
  the build uses, so the page is a faithful rendering of the AST by construction;
  what the verifier adds is that nothing is lost *between* the AST and the HTML.

## Determinism

`build.sh` runs the build twice and requires the two `index.html` files to hash
identically; it prints the digest it verified. Nothing in the page depends on the
clock, the environment or filesystem ordering — the only timestamp-adjacent data
(source hash, tool versions, build counts) lives in `build-info.json`, which the page
does not load.
