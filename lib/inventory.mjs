// Ground-truth inventory, computed from Pandoc's own AST of the paper.
//
// Everything here is *measured*, never transcribed by hand: the numbers in
// INVENTORY.json are a function of behavioral_quotients.md alone.

import { walk, headings, mathNodes, plainText, normalizeText } from './ast.mjs';
import { findCitations } from './citations.mjs';

/** Number of ``` fences (delimiter lines) in the raw source. */
function fenceLineCount(raw) {
  return raw.split('\n').filter((l) => l.trimStart().startsWith('```')).length;
}

/** Headings, tables, code blocks, math and citations attributable to each heading. */
function perSection(ast) {
  const out = [];
  let cur = { heading: '(front matter)', level: 0, counts: empty() };
  const bump = (key, n = 1) => {
    cur.counts[key] += n;
  };

  for (const block of ast.blocks) {
    if (block.t === 'Header') {
      out.push(cur);
      cur = {
        heading: normalizeText(plainText({ blocks: [{ t: 'Header', c: block.c }] })),
        level: block.c[0],
        counts: empty(),
      };
      continue;
    }
    switch (block.t) {
      case 'Table': {
        bump('tables');
        const rows = tableRowCount(block);
        bump('table_rows', rows);
        break;
      }
      case 'CodeBlock':
        bump('code_blocks');
        break;
      case 'OrderedList': {
        const items = block.c[1];
        bump('ordered_lists');
        bump('list_items', items.length);
        break;
      }
      case 'BulletList':
        bump('bullet_lists');
        bump('list_items', block.c.length);
        break;
      default:
        break;
    }
    const text = plainText(block);
    walk(block, (n) => {
      if (n.t !== 'Math') return;
      bump(n.c[0].t === 'InlineMath' ? 'inline_eq' : 'display_eq');
    });
    bump('citations', findCitations(text).length);
    bump('chars', normalizeText(text).length);
  }
  out.push(cur);
  return out;
}

function empty() {
  return {
    display_eq: 0,
    inline_eq: 0,
    citations: 0,
    tables: 0,
    table_rows: 0,
    code_blocks: 0,
    ordered_lists: 0,
    bullet_lists: 0,
    list_items: 0,
    chars: 0,
  };
}

function tableRowCount(tbl) {
  const c = tbl.c;
  let n = c[3][1].length; // head rows
  for (const body of c[4]) n += body[2].length + body[3].length;
  return n;
}

export function buildInventory(ast, rawMarkdown) {
  const m = mathNodes(ast);
  const allTex = [...m.inline, ...m.display];
  const text = plainText(ast);
  const cits = findCitations(text);

  const cited = new Set();
  for (const c of cits) for (const r of c.refs) cited.add(r);

  // The reference list is the last ordered list and is the only one with 194 items.
  const ols = [];
  walk(ast, (n) => {
    if (n.t === 'OrderedList') ols.push(n.c[1].length);
  });
  const refCount = Math.max(...ols);

  const hasLetters = (c) => /[A-Za-z]/.test(c.body);
  const hasDash = (c) => /[–-]/.test(c.body);
  const withDescriptor = cits.filter(hasLetters).length;
  const withRange = cits.filter((c) => !hasLetters(c) && hasDash(c)).length;
  const numericOnly = cits.length - withDescriptor - withRange;

  const heads = headings(ast);
  const byLevel = {};
  for (const h of heads) byLevel[`h${h.level}`] = (byLevel[`h${h.level}`] || 0) + 1;

  const neverCited = [];
  for (let i = 1; i <= refCount; i++) if (!cited.has(i)) neverCited.push(i);

  return {
    source: 'behavioral_quotients.md',
    generated_by: 'build.mjs',
    totals: {
      headings: heads.length,
      headings_by_level: byLevel,
      display_math: m.display.length,
      inline_math: m.inline.length,
      citation_tokens: cits.length,
      citation_tokens_numeric_only: numericOnly,
      citation_tokens_with_range: withRange,
      citation_tokens_with_descriptor: withDescriptor,
      distinct_citation_tokens: new Set(cits.map((c) => c.token)).size,
      // Data rows only. The dispatch brief's 109 counts every source line
      // beginning with `|`, which also counts one `|---|---|` separator row per
      // table (9 tables); 100 + 9 = 109.
      table_rows: countTableRows(ast),
      table_rows_as_pipe_lines: countTableRows(ast) + countTables(ast),
      tables: countTables(ast),
      code_fences: fenceLineCount(rawMarkdown),
      code_blocks: countCodeBlocks(ast),
      ordered_lists: ols.length,
      references: refCount,
      references_never_cited: neverCited,
      // Alphabetic control sequences only (\boxed, \tfrac, …): the dispatch
      // brief's 119. `tex_commands` lists them so the set can be diffed.
      distinct_tex_commands: texCommands(allTex).size,
      // The same, plus the symbol/escape tokens \ , \! \, \\ \{ \} \| \# \%,
      // which MathJax must also handle.
      distinct_tex_tokens: texTokens(allTex).size,
      tex_commands: [...texCommands(allTex)].sort(),
      tex_tokens: [...texTokens(allTex)].sort(),
    },
    // The dispatch brief quoted 339 citation tokens and 467 inline-math tokens.
    // Both were produced by source-text regexes that (a) did not exclude math
    // spans and (b) could not see multi-line inline math. The AST-derived
    // numbers below are authoritative; the discrepancy is recorded rather than
    // silently reconciled. See README.md § "Discrepancies with the dispatch brief".
    dispatched_totals: {
      headings: 40,
      display_math: 28,
      inline_math: 467,
      table_rows: 109,
      code_fences: 2,
      citation_tokens: 339,
      references: 194,
    },
    per_section: perSection(ast),
  };
}

function countTables(ast) {
  let n = 0;
  walk(ast, (x) => {
    if (x.t === 'Table') n++;
  });
  return n;
}

function countCodeBlocks(ast) {
  let n = 0;
  walk(ast, (x) => {
    if (x.t === 'CodeBlock') n++;
  });
  return n;
}

function countTableRows(ast) {
  let n = 0;
  walk(ast, (x) => {
    if (x.t === 'Table') n += tableRowCount(x);
  });
  return n;
}

/** Distinct alphabetic control sequences appearing in TeX, e.g. \boxed, \tfrac. */
function texCommands(texStrings) {
  const set = new Set();
  for (const tex of texStrings) {
    for (const m of tex.matchAll(/\\([A-Za-z]+)/g)) set.add('\\' + m[1]);
  }
  return set;
}

/** As above, plus one-character control symbols such as \, and \\ . */
function texTokens(texStrings) {
  const set = new Set();
  for (const tex of texStrings) {
    for (const m of tex.matchAll(/\\([A-Za-z]+|.)/g)) set.add('\\' + m[1]);
  }
  return set;
}
