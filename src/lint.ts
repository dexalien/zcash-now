/**
 * Detects Zcash code that was correct before NU6.3/NU7 and is not correct now.
 *
 * Every finding points at a rule in facts.ts, so the reason is traceable to a
 * ZIP or a changelog entry rather than to this file's opinion.
 */

import { RULES, type Impact, rule } from "./facts.js";

export interface Finding {
  ruleId: string;
  line: number;
  matched: string;
  impact: Impact[];
  why: string;
  fix: string;
  sources: string[];
}

interface Pattern {
  ruleId: string;
  /** Must carry the `g` and `m` flags so every occurrence is reported. */
  re: RegExp;
  fix: string;
  /** Narrow a match further, to keep false positives down. */
  unless?: RegExp;
}

const PATTERNS: Pattern[] = [
  {
    ruleId: "dead-endpoint",
    re: /lightwalletd\.testnet\.electriccoin\.co|testnet\.lightwalletd\.com/gim,
    fix: "Point at testnet.zec.rocks:443. The retired servers do not answer.",
  },
  {
    ruleId: "expiry-120-not-40",
    re: /(expiry|expiry_height|expiryHeight|EXPIRY)[^\n]{0,40}\b40\b/gim,
    fix:
      "From NU7 activation a transaction expires 120 blocks after its target " +
      "height. Let the SDK set the expiry rather than writing a constant.",
  },
  {
    ruleId: "v4-disallowed",
    re: /\b(version\s*[:=]\s*4|v4_?tx|TxVersion\.?V4|tx_version\s*[:=]\s*4)\b/gim,
    fix: "Build v5 transactions (ZIP 225). NU7 disallows version 4 (ZIP 2003).",
  },
  {
    ruleId: "let-the-sdk-compute-fees",
    re: /\b(fee|FEE|marginal_fee|marginalFee)\s*[:=]\s*(1_?000|5_?000|10_?000|0\.0000[15])\b/gim,
    fix:
      "Ask the light-wallet server with GetStandardFee, or let the SDK compute " +
      "the ZIP 317 fee. A constant that was right last month is wrong now: the " +
      "server currently reports 1000 zatoshis per logical action.",
  },
  {
    ruleId: "six-hrps-not-one",
    re: /(startsWith|starts_with|hasPrefix|\.match|indexOf)\s*\(\s*['"`](u1|utest1|u|utest)['"`]/gim,
    fix:
      "Decode the address instead of matching a prefix. Revision 2 adds " +
      "zu/zutest and tu/tutest, and a prefix check accepts a truncated or " +
      "corrupted address that fails its Bech32m checksum.",
  },
  {
    ruleId: "no-ironwood-receiver",
    re: /\b(ironwood[_-]?(receiver|address|typecode)|receiver[_-]?ironwood|typecode[^\n]{0,20}ironwood)\b/gim,
    fix:
      "There is no Ironwood receiver type or typecode. Typecode 0x03 is still " +
      "named Orchard, and it is how Ironwood funds are received after NU6.3.",
  },
  {
    ruleId: "must-understand-metadata",
    re: /(ignore|skip|continue)[^\n]{0,60}(unknown|unrecogni[sz]ed)[^\n]{0,30}(typecode|receiver|item)/gim,
    fix:
      "Unknown items may be ignored only below 0xE0. Typecodes 0xE0, 0xE1 and " +
      "0xE2..=0xFC are MUST-understand: reject the whole address instead.",
  },
  {
    ruleId: "orchard-sealed",
    re: /\b(use\s+orchard|orchard[_-]?only|only\s+orchard|to_?orchard_?pool)\b/gim,
    fix:
      "Orchard is sealed since NU6.3: no transaction may create new Orchard " +
      "outputs. New shielded value goes to Ironwood.",
  },
  {
    ruleId: "broken-dep-webzjs",
    re: /@chainsafe\/webzjs[\w-]*/gim,
    fix:
      "Not published on npm and no Ironwood support. Install will fail. Pick a " +
      "stack from tool_status before building on it.",
  },
  {
    ruleId: "broken-dep-zecli",
    re: /\b(zecli|zcli)\s*=\s*["']?\d|cargo\s+install\s+(zecli|zcli)\b/gim,
    fix:
      "The crates.io build makes Orchard-only addresses, which cannot receive " +
      "funds. Build zingolib from git instead.",
  },
  {
    ruleId: "broken-dep-zcash-sdk",
    re: /["']@zcash\/sdk["']/gim,
    fix:
      "Not published on npm, despite being widely recommended. ZIP 321 is a " +
      "URI spec: implement it directly, or use payment_request from this server.",
  },
  {
    ruleId: "payment-lifecycle",
    re: /\b(25\s*(seconds?|s)\b[^\n]{0,30}(confirm|final|done)|confirmed\s*=\s*true[^\n]{0,20}(sent|broadcast))/gim,
    fix:
      "25 seconds is NU7's block *target* (ZIP 218, Proposed), not a settlement " +
      "guarantee. Treat a payment as seen, then mined, then confirmed.",
  },
  {
    ruleId: "txid-byte-order",
    re: /Buffer\.from\(\s*txid[^\n]{0,40}["']hex["']\s*\)(?!\s*\.reverse)/gim,
    fix:
      "TxFilter.hash takes the txid in internal byte order, which is the " +
      "reverse of the hex an explorer prints. Add .reverse() or the lookup " +
      "returns not-found for a valid txid.",
  },
];

/** Extra reasons that are not in RULES because they are tooling, not consensus. */
const EXTRA_WHY: Record<string, { why: string; impact: Impact[]; sources: string[] }> = {
  "dead-endpoint": {
    why: "These light-wallet servers are retired and do not answer.",
    impact: ["invalid"],
    sources: ["https://github.com/zcash/lightwallet-protocol"],
  },
  "broken-dep-webzjs": {
    why: "The package is not on npm and does not support Ironwood.",
    impact: ["stale"],
    sources: ["npm view @chainsafe/webzjs-wallet (not published, checked 2026-11-04)"],
  },
  "broken-dep-zecli": {
    why: "The published CLI generates addresses that cannot receive funds.",
    impact: ["funds"],
    sources: ["https://crates.io/crates/zecli"],
  },
  "broken-dep-zcash-sdk": {
    why: "The package is not published on npm, so the build will fail.",
    impact: ["stale"],
    sources: ["npm view @zcash/sdk (not published, checked 2026-11-04)"],
  },
  "txid-byte-order": {
    why:
      "A txid is printed in reverse byte order relative to the internal " +
      "representation the gRPC call expects.",
    impact: ["invalid"],
    sources: ["zcash/lightwallet-protocol v0.6.0, message TxFilter"],
  },
};

export function lint(code: string): Finding[] {
  const lines = code.split(/\r?\n/);
  const findings: Finding[] = [];

  for (const p of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (p.unless?.test(line)) continue;
      // Fresh lastIndex per line, since the patterns are global.
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(line)) !== null) {
        const r = rule(p.ruleId);
        const extra = EXTRA_WHY[p.ruleId];
        findings.push({
          ruleId: p.ruleId,
          line: i + 1,
          matched: m[0].trim().slice(0, 160),
          impact: r?.impact ?? extra?.impact ?? ["stale"],
          why: r?.trap ?? extra?.why ?? "Outdated pattern.",
          fix: p.fix,
          sources: r?.sources ?? extra?.sources ?? [],
        });
        if (m[0].length === 0) break;
      }
    }
  }

  // Worst first: funds, then privacy, then invalid, then stale.
  const weight = (f: Finding) =>
    f.impact.includes("funds") ? 0
      : f.impact.includes("privacy") ? 1
      : f.impact.includes("invalid") ? 2
      : 3;

  return findings.sort((a, b) => weight(a) - weight(b) || a.line - b.line);
}

export function summarize(findings: Finding[]): string {
  if (findings.length === 0)
    return (
      "No outdated Zcash patterns found. This checks for the known NU6.3/NU7 " +
      "regressions listed by `zcash_rules`; it is not a proof of correctness."
    );

  const funds = findings.filter((f) => f.impact.includes("funds")).length;
  const privacy = findings.filter((f) => f.impact.includes("privacy")).length;

  const head = [`${findings.length} finding(s).`];
  if (funds) head.push(`${funds} can cost funds.`);
  if (privacy) head.push(`${privacy} leak privacy.`);

  const body = findings
    .map(
      (f) =>
        `line ${f.line} [${f.impact.join(",")}] ${f.ruleId}\n` +
        `  matched: ${f.matched}\n` +
        `  why:     ${f.why}\n` +
        `  fix:     ${f.fix}\n` +
        (f.sources.length ? `  source:  ${f.sources.join("\n           ")}\n` : ""),
    )
    .join("\n");

  return `${head.join(" ")}\n\n${body}`;
}

export const RULE_IDS = [
  ...new Set([...RULES.map((r) => r.id), ...PATTERNS.map((p) => p.ruleId)]),
];
