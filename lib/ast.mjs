// Pandoc JSON-AST helpers.
//
// Ground truth for every structural comparison is the AST that Pandoc itself
// produces from ../behavioral_quotients.md. Using Pandoc's own reader (rather
// than a hand-rolled markdown regex) is what makes the 1:1 claim mechanical:
// there is exactly one markdown parser in the loop and it is a real one.

import { execFileSync } from 'node:child_process';

// Reader flags. `tex_math_dollars` is required for $…$ / $$…$$; `pipe_tables`
// for the GitHub-style tables. `smart` is left ON (Pandoc's default for
// `markdown`) so that typographic transforms (curly quotes, en-dashes) are
// applied identically in the build and in the verifier — both read the same
// source with the same reader, so neither side can drift from the other.
export const READER = 'markdown+tex_math_dollars+pipe_tables+smart';

export const MATH_METHOD = '--mathjax';

export function pandocJson(mdPath) {
  const out = execFileSync('pandoc', [mdPath, '-f', READER, '-t', 'json'], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out.toString('utf8'));
}

/**
 * Generic depth-first walk over Pandoc AST nodes. `visit(node)` is called for
 * every object carrying a `t` discriminator, in document order.
 */
export function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (node && typeof node === 'object') {
    const isNode = typeof node.t === 'string';
    if (isNode) visit(node);
    if ('c' in node) walk(node.c, visit);
    // The Pandoc document root carries no `t`/`c`; descend through its keys so
    // that `meta` and `blocks` are reached.
    else if (!isNode) for (const k of Object.keys(node)) walk(node[k], visit);
  }
}

/** All `Math` nodes, split by kind, in document order. */
export function mathNodes(ast) {
  const inline = [];
  const display = [];
  walk(ast, (n) => {
    if (n.t !== 'Math') return;
    const kind = n.c[0].t;
    (kind === 'InlineMath' ? inline : display).push(n.c[1]);
  });
  return { inline, display };
}

/**
 * Plain visible text of the whole document, in document order.
 *
 * Math is elided (it is compared separately, via data-tex), code text is kept
 * (it is visible), and URL/title payloads of links and images are omitted
 * because they are not part of what a reader sees.
 */
export function plainText(ast, opts = {}) {
  const chunks = [];
  const skipCode = opts.skipCode === true;
  walkText(ast, chunks, skipCode);
  return chunks.join('');
}

// Block-level Pandoc types. Used only to decide where a *separator* belongs:
// Pandoc's HTML writer emits each block as its own element, so the browser sees
// whitespace between two adjacent blocks, while a naive AST walk would glue
// them together ("…(§7.5).Contribution." vs "…(§7.5). Contribution."). Emitting
// one space between adjacent block siblings makes the two extractions agree
// without inventing any character that a reader would not see.
const BLOCK_TYPES = new Set([
  'Plain',
  'Para',
  'LineBlock',
  'CodeBlock',
  'RawBlock',
  'BlockQuote',
  'OrderedList',
  'BulletList',
  'DefinitionList',
  'Header',
  'HorizontalRule',
  'Table',
  'Div',
  'Figure',
]);

/** True when `x` is a block node, or an array that contains one. */
function isBlockish(x) {
  if (Array.isArray(x)) return x.some(isBlockish);
  return !!x && typeof x === 'object' && BLOCK_TYPES.has(x.t);
}

function walkText(node, chunks, skipCode) {
  if (Array.isArray(node)) {
    let prevBlock = false;
    for (const n of node) {
      const block = isBlockish(n);
      if (block && prevBlock) chunks.push(' ');
      prevBlock = block;
      walkText(n, chunks, skipCode);
    }
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.t !== 'string') {
    // Container (document root, attr, etc.) — descend through its values.
    for (const k of Object.keys(node)) walkText(node[k], chunks, skipCode);
    return;
  }
  switch (node.t) {
    case 'Str':
      chunks.push(node.c);
      return;
    case 'Space':
    case 'SoftBreak':
    case 'LineBreak':
      chunks.push(' ');
      return;
    case 'Math':
      chunks.push(' \u0000MATH\u0000 '); // placeholder keeps token boundaries sane
      return;
    // Pandoc's `smart` extension turns straight quotes into Quoted nodes; the
    // marks themselves live in the node's discriminant rather than in any Str,
    // so they must be re-emitted here. Pandoc's HTML writer emits the same
    // curly glyphs, which is what keeps the two sides comparable.
    case 'Quoted': {
      const double = node.c[0].t === 'DoubleQuote';
      chunks.push(double ? '\u201c' : '\u2018');
      walkText(node.c[1], chunks, skipCode);
      chunks.push(double ? '\u201d' : '\u2019');
      return;
    }
    case 'Code':
      chunks.push(skipCode ? ' ' : node.c[1]);
      return;
    case 'RawInline':
      return;
    default:
      break;
  }
  if ('c' in node) walkText(node.c, chunks, skipCode);
}

/**
 * Split the document into sections keyed by heading. Returns a flat, ordered
 * list of { level, text, blocks } where `blocks` is everything between this
 * heading and the next heading of any level. Content before the first heading
 * is returned with level 0 and text ''.
 */
export function sections(ast) {
  const out = [];
  let cur = { level: 0, text: '', blocks: [] };
  for (const block of ast.blocks) {
    if (block.t === 'Header') {
      out.push(cur);
      cur = { level: block.c[0], text: inlineText(block.c[2]), blocks: [] };
    } else {
      cur.blocks.push(block);
    }
  }
  out.push(cur);
  return out;
}

/** Visible text of a list of inline nodes. */
export function inlineText(inlines) {
  const chunks = [];
  walkText(inlines, chunks, false);
  return chunks.join('');
}

/** Visible text of a list of block nodes. `skipCode` elides verbatim text. */
export function blocksText(blocks, opts = {}) {
  const chunks = [];
  walkText(blocks, chunks, opts.skipCode === true);
  return chunks.join('');
}

/** Headings in document order: { level, text }. */
export function headings(ast) {
  const out = [];
  walk(ast, (n) => {
    if (n.t === 'Header') out.push({ level: n.c[0], text: inlineText(n.c[2]) });
  });
  return out;
}

/**
 * Normalisation used by every text-equality assertion.
 *
 * Collapses runs of whitespace, strips the math placeholder, and normalises the
 * Unicode spaces Pandoc emits when it reflows lines. It deliberately does NOT
 * touch letters, digits or punctuation: any real wording change survives.
 *
 * U+FE0E / U+FE0F are variation selectors — presentation hints, not content.
 * Pandoc's HTML writer appends U+FE0E to glyphs such as `↔` to request the text
 * presentation, while the AST carries the bare codepoint; stripping the
 * selectors is what makes "↔" on the HTML side and "↔" on the AST side compare
 * equal. No letter, digit, space or punctuation mark is affected.
 */
export function normalizeText(s) {
  return s
    .replace(/\u0000MATH\u0000/g, ' ')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\ufe0e\ufe0f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
