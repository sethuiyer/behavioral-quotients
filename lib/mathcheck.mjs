// Typeset every equation in a page through the MathJax v3 node API.
//
// Shared by check-math.mjs (a standalone gate) and verify.mjs (test T9), so the
// two can never disagree about what "the equation renders" means.
//
// The shipped page uses tex-chtml-full, which bundles every TeX package. The
// package list here mirrors it except for `bussproofs`, which the paper never
// uses and which requires an output jax with getBBox() — unavailable in the
// headless liteAdaptor.

import { parseHTML } from 'linkedom';

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';

const CONTAINER_WIDTH = 80 * 16;

let engine = null;

function getEngine() {
  if (engine) return engine;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const input = new TeX({ packages: AllPackages.filter((p) => p !== 'bussproofs') });
  const doc = mathjax.document('', { InputJax: input });
  const visitor = new SerializedMmlVisitor();
  engine = {
    convert: (tex, display) =>
      visitor.visitTree(doc.convert(tex, { display, em: 16, ex: 8, containerWidth: CONTAINER_WIDTH })),
  };
  return engine;
}

function stripTags(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} htmlSource  full HTML of the page
 * @returns {{equations:number, equations_in_article:number, equations_in_toc:number,
 *            inline:number, display:number, typeset_ok:number, errors:number,
 *            failures:Array<{tex:string,display:boolean,error:string,where:string}>}}
 */
export function checkMath(htmlSource) {
  const { document } = parseHTML(htmlSource);
  const nodes = Array.from(document.querySelectorAll('[data-tex]'));
  const jax = getEngine();

  const failures = [];
  let ok = 0;

  for (const el of nodes) {
    const tex = el.getAttribute('data-tex');
    const display = el.getAttribute('data-display') === 'true';
    const where = el.closest('#d-article') ? 'article' : el.closest('#d-toc') ? 'toc' : 'other';
    try {
      const mml = jax.convert(tex, display);
      const err = /<merror[^>]*>(.*?)<\/merror>/s.exec(mml);
      if (err) failures.push({ tex, display, error: stripTags(err[1]), where });
      else ok++;
    } catch (e) {
      failures.push({ tex, display, error: String(e?.message ?? e), where });
    }
  }

  const inArticle = nodes.filter((n) => n.closest('#d-article'));
  const inToc = nodes.filter((n) => n.closest('#d-toc'));

  return {
    equations: nodes.length,
    equations_in_article: inArticle.length,
    equations_in_toc: inToc.length,
    inline: nodes.filter((n) => n.getAttribute('data-display') !== 'true').length,
    display: nodes.filter((n) => n.getAttribute('data-display') === 'true').length,
    typeset_ok: ok,
    errors: failures.length,
    failures,
  };
}
