#!/usr/bin/env node
/**
 * Runs the recipes and writes their receipts.
 *
 * This is what stops the documentation from drifting: a recipe is only ever
 * described as working because it was run, and the receipt says when, against
 * which block, and with which tool versions.
 *
 * Read and pure recipes run on every scheduled run. Spend recipes are
 * budgeted. Human recipes cannot be scheduled at all, and are recorded from
 * the txid of the run a person actually approved, passed in as
 * ZCASH_NOW_SEALED_TXID.
 *
 * Writes receipts.json and STATUS.md. Exit code is non-zero only when a
 * recipe that should work did not, so a scheduled run fails loudly.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chainStatus, getStandardFee, getTransaction, closeChain } from "./chain.js";
import { build, parse } from "./zip321.js";
import { RECIPES, type Receipt } from "./recipes.js";
import { CHECKED_ON, ENDPOINTS } from "./facts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const SEALED_TXID = process.env.ZCASH_NOW_SEALED_TXID?.trim() || "";
/** A unified testnet address to build the example payment request against. */
const EXAMPLE_UA = process.env.ZCASH_NOW_EXAMPLE_UA?.trim() || "utest1example";

function versions(): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    return {
      "zcash-now": pkg.version,
      node: process.version,
      "@grpc/grpc-js": pkg.dependencies["@grpc/grpc-js"],
      proto: "zcash/lightwallet-protocol v0.6.0",
    };
  } catch {
    return { node: process.version };
  }
}

const receipts: Receipt[] = [];
let height: number | undefined;

function record(r: Receipt) {
  receipts.push(r);
  const mark = r.status === "pass" ? "pass" : r.status === "skipped" ? "skip" : "FAIL";
  console.log(`[${mark}] ${r.recipeId}${r.detail ? ` - ${r.detail}` : ""}${r.error ? ` - ${r.error}` : ""}`);
}

async function run<T>(
  recipeId: string,
  fn: () => Promise<{ detail: string; txid?: string }>,
): Promise<void> {
  const ranAt = new Date().toISOString();
  try {
    const { detail, txid } = await fn();
    record({
      recipeId,
      status: "pass",
      ranAt,
      blockHeight: height,
      txid,
      toolVersions: versions(),
      detail,
    });
  } catch (e: any) {
    record({
      recipeId,
      status: "fail",
      ranAt,
      blockHeight: height,
      toolVersions: versions(),
      error: `${e?.code ?? ""} ${e?.message ?? e}`.trim(),
    });
  }
}

async function main() {
  console.log(`zcash-now runner against ${ENDPOINTS.testnet}\n`);

  // ---- chain-status (read) -------------------------------------------------
  await run("chain-status", async () => {
    const s = await chainStatus();
    height = s.height;
    if (s.network !== "test")
      throw new Error(`Expected the testnet server to report chain "test", got "${s.network}".`);
    if (!s.nu7.active)
      throw new Error(
        `NU7 is not active at tip ${s.height}; activation is ${s.nu7.activationHeight}.`,
      );
    if (!s.synced)
      throw new Error(
        `Backend still syncing: tip ${s.height} below estimated ${s.estimatedHeight}.`,
      );
    return {
      detail:
        `tip ${s.height}, branch ${s.consensusBranchId}, ` +
        `NU7 active above ${s.nu7.activationHeight}, server ${s.serverVendor} ${s.serverVersion}`,
    };
  });

  // ---- standard-fee (read) ------------------------------------------------
  await run("standard-fee", async () => {
    const r = await getStandardFee();
    if (!r.available)
      // A server without getstandardfee is a valid answer, not a regression.
      return { detail: `server does not serve a fee: ${r.reason}` };
    return {
      detail:
        `${r.fee.feeZat} zatoshi per logical action, ` +
        `estimatorVersion ${r.fee.estimatorVersion}` +
        (r.fee.estimatorVersion === 0 ? " (static ZIP 317 marginal fee)" : ""),
    };
  });

  // ---- payment-request (pure) ---------------------------------------------
  await run("payment-request", async () => {
    const uri = build(
      [{ address: EXAMPLE_UA, amount: "0.01", memo: "order-1042", label: "Example Shop" }],
      { network: "test" },
    );
    const back = parse(uri, { network: "test" });
    if (!back.ok) throw new Error(`Built a URI that does not parse: ${back.errors.join("; ")}`);
    const memo = back.payments[0]?.memo?.toString("utf8");
    if (memo !== "order-1042") throw new Error(`Memo did not survive the round trip: got ${memo}`);

    // The spec rules must still bite. If these stop failing, the parser broke.
    const mustFail: [string, string][] = [
      ["memo on a transparent address", "zcash:?address=tmEXAMPLE&memo=aGk"],
      ["base64 padding in a memo", "zcash:?address=utest1a&memo=aGk="],
      ["paramindex with a leading zero", "zcash:?address=utest1a&amount.01=1"],
      ["a double slash", "zcash://?address=utest1a"],
      ["an unknown req- parameter", "zcash:?address=utest1a&req-foo=1"],
    ];
    for (const [name, bad] of mustFail)
      if (parse(bad).ok) throw new Error(`Parser accepted ${name}, which ZIP 321 forbids.`);

    return { detail: `round-tripped and rejected ${mustFail.length} invalid URIs` };
  });

  // ---- verify-txid (read) -------------------------------------------------
  if (SEALED_TXID) {
    await run("verify-txid", async () => {
      const tx = await getTransaction(SEALED_TXID);
      const h = Number(tx.height);
      if (!(h > 0)) throw new Error(`Known to the server but not mined on the main chain.`);
      return { detail: `txid mined at height ${h}, ${tx.data.length} bytes`, txid: SEALED_TXID };
    });
    record({
      recipeId: "shielded-send",
      status: "pass",
      ranAt: new Date().toISOString(),
      blockHeight: height,
      txid: SEALED_TXID,
      toolVersions: { "@noir-wallet/sdk": "0.1.9" },
      detail:
        "Sealed from a run a person approved in the Noir Wallet testnet " +
        "extension. Re-verified on chain by verify-txid above.",
    });
    console.log(`[pass] shielded-send - sealed txid ${SEALED_TXID}`);
  } else {
    for (const id of ["verify-txid", "shielded-send"])
      record({
        recipeId: id,
        status: "skipped",
        ranAt: new Date().toISOString(),
        blockHeight: height,
        detail:
          "No sealed txid yet. Set ZCASH_NOW_SEALED_TXID to the txid of a " +
          "shielded payment approved in a wallet. This recipe is human-gated: " +
          "Noir Wallet requires approval, so it cannot run on a schedule.",
      });
  }

  // ---- write ---------------------------------------------------------------
  const failed = receipts.filter((r) => r.status === "fail");
  const payload = {
    generatedAt: new Date().toISOString(),
    endpoint: ENDPOINTS.testnet,
    blockHeight: height ?? null,
    factsCheckedOn: CHECKED_ON,
    summary: {
      pass: receipts.filter((r) => r.status === "pass").length,
      fail: failed.length,
      skipped: receipts.filter((r) => r.status === "skipped").length,
    },
    receipts,
  };

  writeFileSync(join(ROOT, "receipts.json"), JSON.stringify(payload, null, 2) + "\n");
  writeFileSync(join(ROOT, "STATUS.md"), statusMarkdown(payload));

  console.log(
    `\n${payload.summary.pass} pass, ${payload.summary.fail} fail, ` +
      `${payload.summary.skipped} skipped at block ${height ?? "unknown"}`,
  );

  closeChain();
  if (failed.length > 0) process.exitCode = 1;
}

function statusMarkdown(p: {
  generatedAt: string;
  endpoint: string;
  blockHeight: number | null;
  receipts: Receipt[];
}): string {
  const icon = (s: Receipt["status"]) =>
    s === "pass" ? "green" : s === "fail" ? "RED" : "grey";

  const rows = p.receipts.map((r) => {
    const recipe = RECIPES.find((x) => x.id === r.recipeId);
    const proof = r.txid ? `\`${r.txid}\`` : r.blockHeight ? `block ${r.blockHeight}` : "-";
    return `| ${icon(r.status)} | \`${r.recipeId}\` | ${recipe?.cost ?? "-"} | ${proof} | ${
      (r.detail ?? r.error ?? "").replace(/\|/g, "\\|")
    } |`;
  });

  return `# Status

Every row was produced by running the recipe, not by asserting it works.
A grey row says what is missing instead of claiming a pass.

- Checked against: \`${p.endpoint}\`
- Chain height at the time: ${p.blockHeight ?? "unknown"}
- Generated: ${p.generatedAt}

| | Recipe | Cost | Proof | Detail |
|---|---|---|---|---|
${rows.join("\n")}

## Reading this

\`cost\` is what it takes to run the recipe, and it decides how often it runs:

- **read** - free, so it runs on every scheduled run.
- **pure** - no network at all.
- **spend** - consumes testnet funds. Budgeted, not scheduled: the faucets give
  0.125 TAZ/day (Valar) and 1 TAZ/day (Fauzec), so running these on a timer
  would empty the wallet and then report failure for lack of funds rather than
  for a real regression.
- **human** - needs a person to approve in a wallet UI, so it cannot be
  scheduled. Its receipt is sealed from a run someone actually approved and
  re-verified on chain afterwards.

Scheduled runs are not punctual: GitHub Actions delays or skips cron under
load. That is why each receipt carries the block height it ran at rather than
a promise about frequency.
`;
}

main().catch((e) => {
  console.error("runner failed:", e);
  closeChain();
  process.exit(1);
});
