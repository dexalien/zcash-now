/**
 * Checks the fact base against the ZIP index it claims to be quoting.
 *
 * Rule 1 of this project is "if the chain can answer it, ask the chain", and
 * anything asked cannot go stale. Rule 2 is "if it must be stated, state its
 * source", and a stated fact absolutely can go stale: it is one person's
 * reading, frozen. This closes that asymmetry. If a ZIP's status changes, the
 * recipe goes red and names the drift, which is the same failure mode this
 * project exists to catch, pointed at itself.
 *
 * There is no machine-readable index at zips.z.cash, so the published table is
 * parsed. The parser is deliberately strict: if the page's shape changes it
 * reports that it could not read the index, rather than silently finding
 * nothing and declaring everything fine.
 */

import { ZIPS } from "./facts.js";

const INDEX_URL = "https://zips.z.cash/";

export type Status =
  | "final"
  | "active"
  | "proposed"
  | "draft"
  | "reserved"
  | "withdrawn"
  | "obsolete";

const STATUS_WORDS: Status[] = [
  "final",
  "active",
  "proposed",
  "draft",
  "reserved",
  "withdrawn",
  "obsolete",
];

export interface IndexRow {
  zip: string;
  title: string;
  rawStatus: string;
}

/**
 * Reduce a status string to comparable parts, so that
 * "Revision 0: Active; Revision 1 (NU6.3): Active; Revision 2: Proposed" and
 * "[Revision 0] Active, [Revision 1] Active, [Revision 2] Proposed" compare
 * equal. Formatting is not drift.
 */
export function normalizeStatus(raw: string): string {
  const text = raw.toLowerCase();
  const found: string[] = [];
  // Optional "revision N" prefix, then a status word, skipping anything
  // parenthesised in between such as "(NU6.3)".
  // The revision marker carries an optional label that the published index
  // writes inside the bracket, as "[Revision 1: NU6.3] Active", while we write
  // it outside, as "Revision 1 (NU6.3): Active". Both must reduce to r1:active.
  const re = new RegExp(
    `(?:\\[?\\s*revision\\s*(\\d+)\\s*(?::[^\\]|;,]*)?\\]?\\s*(?:\\([^)]*\\))?\\s*[:\\-]?\\s*)?(${STATUS_WORDS.join("|")})`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.push(m[1] !== undefined ? `r${m[1]}:${m[2]}` : m[2]);
  }
  // Dedupe while keeping a stable order, so comparison is order-insensitive.
  return [...new Set(found)].sort().join(",");
}

/** Parse the published index. Throws if the page cannot be read as a table. */
export function parseIndex(html: string): Map<string, IndexRow> {
  const rows = new Map<string, IndexRow>();
  const re =
    /<td>\s*(\d+)\s*<\/td>\s*<td class="left">\s*<a href="zip-\d+">([^<]*)<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    rows.set(String(Number(m[1])), {
      zip: String(Number(m[1])),
      title: m[2].trim(),
      rawStatus: m[3].trim(),
    });
  }

  if (rows.size < 50)
    throw new Error(
      `Read only ${rows.size} rows from the ZIP index, which is too few to be ` +
        "the real table. The page shape probably changed; this is a parser " +
        "problem, not an all-clear.",
    );

  return rows;
}

export type DriftKind = "status-changed" | "not-in-index" | "title-changed";

export interface Drift {
  kind: DriftKind;
  zip: string;
  ours: string;
  theirs: string;
  detail: string;
}

export interface CheckResult {
  checkedAt: string;
  indexUrl: string;
  rowsInIndex: number;
  factsChecked: number;
  drift: Drift[];
}

export async function fetchIndex(timeoutMs = 20_000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(INDEX_URL, {
      signal: ctl.signal,
      headers: { accept: "text/html" },
    });
    if (!res.ok) throw new Error(`${INDEX_URL} answered HTTP ${res.status}.`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a single ZIP's own document for its declared status.
 *
 * Needed because the index's main table does not carry every ZIP: withdrawn
 * ones are listed in a separate section with a different shape. Falling back
 * to the document is stronger than parsing that section, since the document
 * is the primary source.
 */
export async function fetchZipStatus(zip: string): Promise<string | null> {
  const padded = zip.padStart(4, "0");
  try {
    const res = await fetch(`https://zips.z.cash/zip-${padded}`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = /Status:\s*([^<\n]+)/i.exec(html);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/** Compare every ZIP the fact base asserts against the published index. */
export async function compare(index: Map<string, IndexRow>): Promise<Drift[]> {
  const drift: Drift[] = [];

  for (const ours of ZIPS) {
    let theirs = index.get(ours.zip);

    if (!theirs) {
      // Not in the main table. Ask the ZIP's own document before calling it
      // missing: that is where a withdrawn ZIP still states its status.
      const fromDoc = await fetchZipStatus(ours.zip);
      if (fromDoc === null) {
        drift.push({
          kind: "not-in-index",
          zip: ours.zip,
          ours: ours.status,
          theirs: "(absent)",
          detail:
            `We assert ZIP ${ours.zip} but it is neither in the published ` +
            "index nor readable as its own document. Either the number is " +
            "wrong or the ZIP was removed.",
        });
        continue;
      }
      theirs = { zip: ours.zip, title: `ZIP ${ours.zip}`, rawStatus: fromDoc };
    }

    const a = normalizeStatus(ours.status);
    const b = normalizeStatus(theirs.rawStatus);
    if (a !== b) {
      drift.push({
        kind: "status-changed",
        zip: ours.zip,
        ours: ours.status,
        theirs: theirs.rawStatus,
        detail:
          `ZIP ${ours.zip} (${theirs.title}): we say "${ours.status}", the index ` +
          `says "${theirs.rawStatus}". The fact base is out of date.`,
      });
    }
  }

  return drift;
}

export async function checkFactBase(): Promise<CheckResult> {
  const html = await fetchIndex();
  const index = parseIndex(html);
  return {
    checkedAt: new Date().toISOString(),
    indexUrl: INDEX_URL,
    rowsInIndex: index.size,
    factsChecked: ZIPS.length,
    drift: await compare(index),
  };
}
