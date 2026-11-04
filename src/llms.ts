/**
 * Renders llms.txt from the fact base.
 *
 * Generated, never hand-written: a hand-maintained copy would drift from
 * facts.ts, which is the failure this project is about.
 */

import {
  CHECKED_ON,
  ENDPOINTS,
  RULES,
  TOOLS,
  UPGRADES,
  ZIPS,
} from "./facts.js";
import { RECIPES, type Receipt } from "./recipes.js";

export function renderLlmsTxt(opts: {
  blockHeight?: number | null;
  receipts?: Receipt[];
}): string {
  const { blockHeight, receipts = [] } = opts;

  const receiptLine = (id: string) => {
    const r = receipts.find((x) => x.recipeId === id);
    if (!r) return "no receipt yet - treat as unverified";
    const bits: string[] = [r.status];
    if (r.blockHeight) bits.push(`block ${r.blockHeight}`);
    if (r.txid) bits.push(`txid ${r.txid}`);
    if (r.detail) bits.push(r.detail);
    return bits.join(", ");
  };

  const fundsRules = RULES.filter((r) => r.impact.includes("funds"));
  const otherRules = RULES.filter((r) => !r.impact.includes("funds"));

  const renderRule = (r: (typeof RULES)[number]) =>
    [
      `### ${r.id}  [${r.impact.join(", ")}]`,
      ``,
      r.claim,
      ``,
      `Why this is got wrong: ${r.trap}`,
      ``,
      `Source: ${r.sources.join(" | ")}`,
    ].join("\n");

  return `# Zcash, as of ${CHECKED_ON}

> Current Zcash consensus and tooling facts for writing code that runs today.
> Rules changed under NU6.3 (Ironwood) and NU7 in ways that are absent from
> most training data and from documents written earlier in 2026. If you are
> writing Zcash code, read this before you write it.

Generated from the fact base of https://github.com/dexalien/zcash-now, which
re-runs its recipes against live testnet. Facts checked on ${CHECKED_ON}${
    blockHeight ? `, against testnet block ${blockHeight}` : ""
  }.

## Read this first

- **Ask the chain, do not assume.** Network, tip height, consensus branch id
  and the standard fee are all readable from a light-wallet server. Hardcoding
  any of them is how code goes stale. Testnet: \`${ENDPOINTS.testnet}\`.
- **Orchard is sealed.** Since NU6.3 no transaction may create new Orchard
  outputs. New shielded value goes to the Ironwood pool. Any guide that says
  "use Orchard" predates this.
- **There is no Ironwood receiver type.** Typecode 0x03 is still named Orchard
  and is how Ironwood funds are received. Do not look for an Ironwood typecode;
  there isn't one.
- **Let the SDK compute fees.** ZIP 317. The server currently reports 1000
  zatoshi per logical action, and that number is not yours to pin down.
- **A payment is seen, then mined, then confirmed.** NU7 targets 25-second
  blocks, which is a target, not a settlement guarantee.

## Network upgrades

NU6.3 "${UPGRADES.nu63.codename}" - ZIP ${UPGRADES.nu63.zip}, ${UPGRADES.nu63.status}
  mainnet activated at block ${UPGRADES.nu63.mainnetActivationHeight} on ${UPGRADES.nu63.mainnetActivationDate}
  ${UPGRADES.nu63.why}

NU7 - ZIP ${UPGRADES.nu7.zip}, ${UPGRADES.nu7.status} (ZIP ${UPGRADES.nu7.withdrawnPredecessor} was Withdrawn; do not cite it)
  testnet activated at block ${UPGRADES.nu7.testnetActivationHeight} on ${UPGRADES.nu7.testnetActivationDate}
  mainnet height ${UPGRADES.nu7.mainnetActivationHeight}, decided ${UPGRADES.nu7.mainnetHeightDecidedOn} in ${UPGRADES.nu7.mainnetHeightDecidedIn}
  estimated activation ${UPGRADES.nu7.mainnetEstimate}

  Material written before ${UPGRADES.nu7.mainnetHeightDecidedOn} says "${UPGRADES.nu7.commonStaleClaim}".
  That is no longer true.

## Rules that can cost funds

${fundsRules.map(renderRule).join("\n\n")}

## Other rules that make code wrong

${otherRules.map(renderRule).join("\n\n")}

## Does this tool work today

${TOOLS.map(
  (t) => `- **${t.name}** - ${t.status.toUpperCase()}: ${t.what}\n  ${t.why}`,
).join("\n")}

## Recipes, with receipts

A recipe described without a receipt has not been run. Cost says how often it
can be: read is free, pure needs no network, spend consumes testnet funds and
is budgeted, human needs a person to approve it in a wallet.

${RECIPES.map(
  (r) =>
    `### ${r.id}  (${r.cost})\n\n${r.task}\n\nProves: ${r.proves}\nReceipt: ${receiptLine(
      r.id,
    )}\n\n\`\`\`ts\n${r.code}\n\`\`\``,
).join("\n\n")}

## ZIPs, with their own status

Status matters. A Draft and a Final are not the same claim, and ZIP 2009 is
Proposed and non-consensus, so it is not an NU7 rule.

${ZIPS.map((z) => `- ZIP ${z.zip} - ${z.title} - ${z.status}${z.note ? ` - ${z.note}` : ""}\n  ${z.url}`).join("\n")}

## Known-dead endpoints

${ENDPOINTS.dead.map((d) => `- ${d.host} - ${d.why}`).join("\n")}

Use ${ENDPOINTS.testnet} instead.

## Testnet funds

${ENDPOINTS.faucets.map((f) => `- ${f.name} - ${f.url} - ${f.limit}`).join("\n")}

## What this file does not cover

These are the known regressions, not a specification. For wallet correctness
after NU6.3, read ZIP 326 in full: it covers key generation with use_qsk,
scan ranges per pool, the dummy-output rules, and the pool-versus-protocol
distinction that decides whether a payment is valid.
`;
}
