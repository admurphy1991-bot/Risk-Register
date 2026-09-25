// The Sansom register stores each risk's controls as one long paragraph
// ("Trained and competent operator. Do not use in adverse weather. ...").
// For the TA builder a PM needs to tick individual controls, so this splits a
// paragraph into separate control statements. Pure function — safe to use on
// the server, in the AI prompt, and in client components.

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|approx|incl|min|max|no)\./gi;
const PLACEHOLDER = "\u0000";

export function splitControlStatements(text: string | null | undefined): string[] {
  if (!text) return [];
  let s = text.replace(/\s+/g, " ").trim();
  if (!s) return [];

  // Protect abbreviations so "E.g. Scaffold" doesn't split.
  s = s.replace(ABBREVIATIONS, (m) => m.slice(0, -1) + PLACEHOLDER);

  // Sub-headings run into the previous sentence without a full stop, e.g.
  // "...as appropriate Heavy Rain: Use of waterproof PPE." — break before them.
  // The word before the heading must start lowercase, so "Extreme Heat:" stays
  // one heading rather than splitting after "Extreme".
  s = s.replace(/(\b[a-z][\w)-]*)\s+([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?):\s/g, "$1. $2: ");

  const raw = s
    .split(/(?<=[.;!?])\s+(?=[A-Z0-9(])|\n+|\s•\s/)
    .map((p) => p.replace(new RegExp(PLACEHOLDER, "g"), ".").trim())
    .map((p) => p.replace(/^[-•*]\s*/, "").replace(/[.;]+$/, "").trim())
    .filter((p) => p.length >= 3);

  // Carry sub-headings ("Extreme Heat:", "Ice:") onto the statements that
  // follow them — only when the paragraph genuinely uses several headings, so
  // a lone "Note:" doesn't prefix everything after it.
  const headingRe = /^([A-Z][A-Za-z]+(?: [A-Za-z]+){0,2}):\s*(.+)$/;
  const headingCount = raw.filter((p) => headingRe.test(p)).length;
  const out: string[] = [];
  let heading: string | null = null;
  for (const p of raw) {
    const m = headingRe.exec(p);
    if (m && headingCount >= 2) {
      heading = m[1];
      out.push(`${heading}: ${m[2]}`);
    } else if (heading && headingCount >= 2) {
      out.push(`${heading}: ${p}`);
    } else {
      out.push(p);
    }
  }

  // De-duplicate (case-insensitive) while preserving order.
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** All control statements for a register risk, across its control rows. */
export function riskControlStatements(controls: { description: string }[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of controls || []) {
    for (const s of splitControlStatements(c.description)) {
      const key = s.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
    }
  }
  return out;
}
