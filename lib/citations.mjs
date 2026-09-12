// Citation token grammar. Shared by build.mjs and verify.mjs so that "what counts
// as a citation" is a single pinned specification rather than two drifting regexes.
//
// Recognised forms (all of these occur in behavioral_quotients.md):
//
//   [12]                 single reference
//   [12,13,80]           numeric list
//   [166–174]            numeric range (en-dash or hyphen)
//   [40, Schaefer]       numeric list + trailing descriptor
//   [61, Section 6.3]    numeric list + trailing descriptor containing digits
//
// A bracket group only counts as a citation if it opens with a digit. That excludes
// the two other bracketed constructs in the paper, `[Eqs. §3.1–3.2]` and
// `[Aspvall–Plass–Tarjan]`, which are prose, not references.

// One numeric item: `12` or `166–174` / `166-174`.
const ITEM = /^\d+\s*(?:[–-]\s*\d+)?$/;

// Candidate bracket groups: `[...]` whose content starts with a digit.
const CANDIDATE = /\[(\d[^[\]]*)\]/g;

/** Expand one citation body ("166–174, 40, Schaefer") into reference numbers. */
export function expandRefs(body) {
  const parts = body.split(',');
  const refs = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!ITEM.test(part)) continue; // descriptor tail — contributes no ref numbers
    const m = /^(\d+)\s*(?:[–-]\s*(\d+))?$/.exec(part);
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    for (let n = lo; n <= hi; n++) refs.push(n);
  }
  return refs;
}

/** True when the bracket body is a well-formed citation (numeric head + optional descriptor). */
export function isCitationBody(body) {
  const parts = body.split(',');
  const head = parts[0].trim();
  if (!ITEM.test(head)) return false;
  // Every part after the first must be numeric, except possibly the final one,
  // which may be a free-text descriptor.
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].trim();
    if (ITEM.test(p)) continue;
    if (i === parts.length - 1) continue; // descriptor tail
    return false;
  }
  return true;
}

/**
 * Scan a plain-text stream and return every citation token in document order.
 * `token` is the exact visible text including brackets, which both the markdown
 * side and the HTML side must reproduce verbatim.
 */
export function findCitations(text) {
  const out = [];
  CANDIDATE.lastIndex = 0;
  let m;
  while ((m = CANDIDATE.exec(text)) !== null) {
    const body = m[1];
    if (!isCitationBody(body)) continue;
    out.push({
      token: `[${body}]`,
      body,
      refs: expandRefs(body),
      index: m.index,
    });
  }
  return out;
}
