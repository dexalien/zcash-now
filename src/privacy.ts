/**
 * Privacy lint: warns before code gives away more than its author meant to.
 *
 * Separate from lint.ts on purpose. That one finds code that stopped being
 * correct; this one finds code that is correct and still leaks. A transparent
 * address works perfectly and publishes the payment. A memo works perfectly
 * and carries an email address to anyone holding the viewing key.
 *
 * Every finding says what becomes visible and to whom, because "this is a
 * privacy risk" is not actionable and "the light-wallet server learns which
 * addresses you care about" is.
 */

export type Exposure = "chain" | "memo" | "network" | "operator" | "keys";

export interface PrivacyFinding {
  ruleId: string;
  line: number;
  matched: string;
  /** What becomes visible. */
  reveals: string;
  /** Who gets to see it. */
  to: string;
  fix: string;
  exposure: Exposure[];
  severity: "high" | "medium" | "low";
  sources: string[];
}

interface Rule {
  id: string;
  re: RegExp;
  reveals: string;
  to: string;
  fix: string;
  exposure: Exposure[];
  severity: PrivacyFinding["severity"];
  sources: string[];
  /** Skip the line if this also matches: cheap false-positive control. */
  unless?: RegExp;
}

const RULES: Rule[] = [
  // --- keys -----------------------------------------------------------------
  {
    id: "spending-key-in-source",
    re: /\b(spend(ing)?[_-]?key|sk_?spend|seed[_-]?phrase|mnemonic|unified[_-]?spending[_-]?key|usk)\b\s*[:=]\s*["'`][^"'`\n]{8,}/gi,
    reveals:
      "A spending key or seed committed as a literal. Anyone who reads the " +
      "repository, the build log or the image can spend the funds.",
    to: "everyone with read access to the code, now and in every past commit",
    fix:
      "Never place a spending key in source. Keep it outside the process that " +
      "serves requests, and give servers a viewing key instead, which can see " +
      "incoming payments but cannot spend.",
    exposure: ["keys"],
    severity: "high",
    sources: ["https://zips.z.cash/zip-0316"],
  },
  {
    id: "spending-key-in-env",
    re: /(process\.env|os\.environ|getenv|ENV\[)[^\n]{0,24}(spend(ing)?[_-]?key|seed|mnemonic|usk)\b/gi,
    reveals:
      "A spending key reaching a server process. Environment variables appear " +
      "in crash dumps, process listings, orchestrator config and support logs.",
    to: "anyone who can read the host's environment or its logs",
    fix:
      "Give the server a viewing key, not a spending key. If something must " +
      "sign, keep it in a separate process or a wallet the user approves.",
    exposure: ["keys", "operator"],
    severity: "high",
    sources: ["https://zips.z.cash/zip-0316"],
  },

  // --- chain ----------------------------------------------------------------
  {
    id: "transparent-recipient",
    re: /["'`](t1[a-km-zA-HJ-NP-Z1-9]{33}|t3[a-km-zA-HJ-NP-Z1-9]{33}|tm[a-km-zA-HJ-NP-Z1-9]{33}|t2[a-km-zA-HJ-NP-Z1-9]{33})["'`]/g,
    reveals:
      "A transparent address. The amount, the sender and the recipient are " +
      "public on chain forever, and they link to every other payment that " +
      "address ever made.",
    to: "everyone, permanently, including chain-analysis firms",
    fix:
      "Pay a unified address with a shielded receiver. If a transparent hop is " +
      "unavoidable, shield immediately and say so in your privacy note.",
    exposure: ["chain"],
    severity: "high",
    sources: ["https://zips.z.cash/zip-0316"],
  },
  {
    id: "funding-source-transparent",
    re: /fundingSource\s*[:=]\s*["'`]transparent["'`]|\bfrom_?transparent\s*[:=]\s*true/gi,
    reveals:
      "A spend funded from the transparent pool, which publishes the input, " +
      "the amount and the change.",
    to: "everyone",
    fix: 'Use fundingSource: "shielded", or shield the funds first.',
    exposure: ["chain"],
    severity: "high",
    sources: [],
  },
  {
    id: "no-shield-before-spend",
    re: /\b(shieldFunds|shield_funds)\s*\(\s*\)\s*;?\s*\/\/\s*(todo|later|skip)/gi,
    reveals: "A deferred shielding step, which leaves the funds transparent in the meantime.",
    to: "everyone, for as long as it stays deferred",
    fix: "Shield before spending, or treat the flow as public and document it.",
    exposure: ["chain"],
    severity: "medium",
    sources: [],
  },

  // --- memo -----------------------------------------------------------------
  {
    id: "pii-in-memo",
    re: /\bmemo\b[^\n]{0,60}([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\+?\d[\d\s().-]{8,}\d)/gi,
    reveals:
      "An email address or phone number inside a memo. A memo is encrypted on " +
      "chain, but it is readable by anyone holding the viewing key, which is " +
      "exactly what gets handed to accountants, auditors and servers.",
    to: "every holder of the viewing key, now and in the future",
    fix:
      "Put an opaque order id in the memo and keep the mapping to a person in " +
      "your own system. The memo is not a private channel; it is a channel " +
      "whose audience you chose earlier and may not remember.",
    exposure: ["memo"],
    severity: "high",
    sources: ["https://zips.z.cash/zip-0321"],
  },
  {
    id: "identifying-memo-fields",
    re: /memo\s*[:=][^\n]{0,80}\b(name|full_?name|address|dni|passport|tax_?id|customer_?name|phone|email)\b/gi,
    reveals: "Identifying fields placed in a memo.",
    to: "every holder of the viewing key",
    fix: "Send an opaque reference instead, and resolve it on your side.",
    exposure: ["memo"],
    severity: "medium",
    sources: ["https://zips.z.cash/zip-0321"],
  },

  // --- network --------------------------------------------------------------
  {
    id: "plaintext-lightwalletd",
    re: /(http:\/\/[^\s"'`]*(lightwalletd|zec\.rocks|zaino|zebra)[^\s"'`]*)|createInsecure\s*\(/gi,
    reveals:
      "An unencrypted connection to a light-wallet server. Anyone on the path " +
      "sees which addresses you sync and which transactions you fetch.",
    to: "the network operator, the venue WiFi, and anyone in between",
    fix:
      "Use TLS: testnet.zec.rocks:443 with grpc.credentials.createSsl(). " +
      "createInsecure() belongs in a local test network only.",
    exposure: ["network"],
    severity: "high",
    sources: ["https://github.com/zcash/lightwallet-protocol"],
  },
  {
    id: "explorer-lookup",
    re: /(zexplorer\.app|zcashexplorer\.app|blockchair\.com|blockchain\.info)[^\s"'`]*/gi,
    reveals:
      "Which transactions and addresses you are interested in, handed to a " +
      "third-party explorer along with your IP address.",
    to: "the explorer operator, and whoever they share logs with",
    fix:
      "Query a light-wallet server over gRPC instead. Our verify_transaction " +
      "does this. An explorer link is fine for a human to click; it is a leak " +
      "when your code does it on every payment.",
    exposure: ["network"],
    severity: "medium",
    sources: [],
  },
  {
    id: "address-in-url-or-log",
    re: /(console\.(log|info|warn)|print|println!|logger\.\w+)\s*\([^\n)]{0,60}\b(utest1|u1|zs1|ztestsapling1)/gi,
    reveals:
      "A shielded address written to logs, which tends to end up in a hosted " +
      "log service and in support tickets.",
    to: "your log provider, your team, and anyone who can read either",
    fix: "Log an internal id instead, or truncate and mark it as truncated.",
    exposure: ["operator"],
    severity: "medium",
    sources: [],
  },
  {
    id: "viewing-key-client-side",
    re: /(uview|uivk|uvf|uvi)(test)?1[0-9a-z]{20,}/gi,
    reveals:
      "A viewing key as a literal. A viewing key cannot spend, but it can read " +
      "every past and future payment to that account, including memos.",
    to: "anyone who reads this code or ships it to a browser",
    fix:
      "Keep viewing keys server-side and scoped. Shipping one to a client " +
      "publishes the whole account's history.",
    exposure: ["keys", "memo"],
    severity: "high",
    sources: ["https://zips.z.cash/zip-0316"],
  },
  {
    id: "address-reuse",
    re: /\b(const|let|var|static)\s+\w*(DEPOSIT|RECEIVE|PAYOUT|DONATION)\w*\s*[:=]\s*["'`](u1|utest1)/gi,
    reveals:
      "One address reused for every payer, which links all of them to each " +
      "other in the payer's own records and in anything they publish.",
    to: "every payer, and anyone correlating their records",
    fix:
      "Derive a diversified address per payer or per invoice. Shielded " +
      "addresses make this cheap.",
    exposure: ["chain"],
    severity: "low",
    sources: ["https://zips.z.cash/zip-0316"],
  },
];

export function privacyLint(code: string): PrivacyFinding[] {
  const lines = code.split(/\r?\n/);
  const findings: PrivacyFinding[] = [];

  for (const r of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (r.unless?.test(line)) continue;
      r.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = r.re.exec(line)) !== null) {
        findings.push({
          ruleId: r.id,
          line: i + 1,
          matched: m[0].trim().slice(0, 140),
          reveals: r.reveals,
          to: r.to,
          fix: r.fix,
          exposure: r.exposure,
          severity: r.severity,
          sources: r.sources,
        });
        if (m[0].length === 0) break;
      }
    }
  }

  const weight = { high: 0, medium: 1, low: 2 } as const;
  return findings.sort(
    (a, b) => weight[a.severity] - weight[b.severity] || a.line - b.line,
  );
}

export function summarizePrivacy(findings: PrivacyFinding[]): string {
  if (findings.length === 0)
    return (
      "No known privacy leaks found. This checks the patterns listed by " +
      "privacy_rules; passing it is not a privacy review, and it cannot see " +
      "what your architecture reveals. Write the privacy and trust note anyway."
    );

  const high = findings.filter((f) => f.severity === "high").length;
  const head = `${findings.length} finding(s)${high ? `, ${high} high severity` : ""}.`;

  const body = findings
    .map(
      (f) =>
        `line ${f.line} [${f.severity}] ${f.ruleId}\n` +
        `  matched:  ${f.matched}\n` +
        `  reveals:  ${f.reveals}\n` +
        `  to:       ${f.to}\n` +
        `  fix:      ${f.fix}\n`,
    )
    .join("\n");

  return `${head}\n\n${body}`;
}

export const PRIVACY_RULE_IDS = RULES.map((r) => r.id);

/** Reported alongside results, because a clean lint is not a clean design. */
export const LINT_LIMITS = [
  "Pattern matching sees one line at a time. It cannot see that your server " +
    "stores emails next to order ids, that your hosted light-wallet server " +
    "sees every user's IP, or that your analytics gets the payment event.",
  "A memo is encrypted on chain but readable by every viewing-key holder. " +
    "Deciding who holds that key is a design decision no linter can make.",
  "Nothing here checks amounts. A distinctive amount can identify a payment " +
    "even when sender and receiver are shielded.",
];
