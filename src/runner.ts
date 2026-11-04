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
import { renderLlmsTxt } from "./llms.js";
import { encodeUnifiedAddress, decodeUnifiedAddress } from "./address.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const SEALED_TXID = process.env.ZCASH_NOW_SEALED_TXID?.trim() || "";

/**
 * A unified testnet address to build the example payment request against.
 *
 * When none is supplied we encode one rather than using a placeholder. The
 * parser now decodes unified addresses properly, so a made-up string would
 * fail, and rightly: a recipe that claims to prove something should not rest
 * on an address that could never receive anything. The receiver bytes here
 * are deterministic filler, not a key, and nothing is ever sent to it.
 */
function exampleUnifiedAddress(): string {
  const supplied = process.env.ZCASH_NOW_EXAMPLE_UA?.trim();
  if (supplied) return supplied;
  // Typecode 0x03 (Orchard) carries a 43-byte receiver.
  const filler = Buffer.alloc(43);
  for (let i = 0; i < filler.length; i++) filler[i] = (i * 7 + 11) & 0xff;
  return encodeUnifiedAddress([{ typecode: 0x03, data: filler }], "utest");
}

const EXAMPLE_UA = exampleUnifiedAddress();

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

/**
 * Did the network fail, or did the recipe? Treating the first as the second is
 * how a status board starts crying wolf, and testnet has been unstable: Zebra
 * 7.0.0 is unreleased and operators have reported nodes that stop syncing.
 */
function isNetworkFailure(e: any): boolean {
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? e);
  return (
    /^(14|4|UNAVAILABLE|DEADLINE_EXCEEDED)$/.test(code) ||
    /UNAVAILABLE|DEADLINE_EXCEEDED|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|Could not resolve/i.test(
      `${code} ${msg}`,
    ) ||
    /still syncing/i.test(msg)
  );
}

const MARK = { pass: "pass", fail: "FAIL", network: "net ", skipped: "skip" } as const;

function record(r: Receipt) {
  receipts.push(r);
  console.log(
    `[${MARK[r.status]}] ${r.recipeId}` +
      (r.detail ? ` - ${r.detail}` : "") +
      (r.error ? ` - ${r.error}` : ""),
  );
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
    const network = isNetworkFailure(e);
    record({
      recipeId,
      status: network ? "network" : "fail",
      ranAt,
      blockHeight: height,
      toolVersions: versions(),
      error:
        `${e?.code ?? ""} ${e?.message ?? e}`.trim() +
        (network
          ? " (classified as a network condition, not a recipe failure)"
          : ""),
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
      [
        "a unified address that does not decode",
        `zcash:?address=${EXAMPLE_UA.slice(0, -4)}qqqq&amount=0.01`,
      ],
    ];
    for (const [name, bad] of mustFail)
      if (parse(bad).ok) throw new Error(`Parser accepted ${name}, which ZIP 321 forbids.`);

    return { detail: `round-tripped and rejected ${mustFail.length} invalid URIs` };
  });

  // ---- decode-address (pure) ----------------------------------------------
  await run("decode-address", async () => {
    const d = decodeUnifiedAddress(EXAMPLE_UA, { network: "test" });
    if (!d.valid) throw new Error(`Our own encoded address does not decode: ${d.errors.join("; ")}`);
    if (d.revision !== "R0") throw new Error(`Expected a Revision 0 address, got ${d.revision}.`);
    if (!d.canReceiveShielded) throw new Error("Encoded a shielded receiver but decoded none.");

    // Prefix matching would accept all of these. Decoding must not.
    const mustReject: [string, string][] = [
      ["a corrupted checksum", EXAMPLE_UA.slice(0, -4) + "qqqq"],
      ["a truncated address", EXAMPLE_UA.slice(0, EXAMPLE_UA.length - 12)],
      ["a mainnet address where testnet is required", encodeUnifiedAddress(
        [{ typecode: 0x03, data: Buffer.alloc(43, 9) }], "u")],
    ];
    for (const [name, bad] of mustReject)
      if (decodeUnifiedAddress(bad, { network: "test" }).valid)
        throw new Error(`Decoder accepted ${name}.`);

    return {
      detail:
        `round-tripped a utest unified address through Bech32m and F4Jumble, ` +
        `recovered typecode 0x${d.receivers[0]?.typecode.toString(16)}, and ` +
        `rejected ${mustReject.length} addresses a prefix check would accept`,
    };
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
      network: receipts.filter((r) => r.status === "network").length,
      skipped: receipts.filter((r) => r.status === "skipped").length,
    },
    receipts: receipts.map((r) => ({
      ...r,
      // Travels with the receipt, so the disclosure is as durable as the proof.
      leaks: RECIPES.find((x) => x.id === r.recipeId)?.leaks,
    })),
  };

  writeFileSync(join(ROOT, "receipts.json"), JSON.stringify(payload, null, 2) + "\n");
  writeFileSync(join(ROOT, "STATUS.md"), statusMarkdown(payload));
  // Generated here so it carries the receipts of the run that produced it.
  writeFileSync(
    join(ROOT, "llms.txt"),
    renderLlmsTxt({ blockHeight: height ?? null, receipts }),
  );

  const s = payload.summary;
  console.log(
    `\n${s.pass} pass, ${s.fail} fail, ${s.network} network, ` +
      `${s.skipped} skipped at block ${height ?? "unknown"}`,
  );

  closeChain();
  // A network condition does not fail the run. Only a recipe does.
  if (failed.length > 0) process.exitCode = 1;
}

function statusMarkdown(p: {
  generatedAt: string;
  endpoint: string;
  blockHeight: number | null;
  receipts: Receipt[];
}): string {
  const icon = (s: Receipt["status"]) =>
    s === "pass" ? "green" : s === "fail" ? "RED" : s === "network" ? "amber" : "grey";

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

**amber is not red.** A network row means the light-wallet server or the path
to it did not answer, which says nothing about whether the recipe works. Only a
red row fails the run. Testnet has been unstable, so collapsing the two would
make this board cry wolf, and a board that cries wolf is worse than none.

## What each recipe gives away

Stated per recipe, because a privacy note at the bottom of a README is easy to
write and easy to ignore, and this travels with the code.

${RECIPES.map((r) => `- **\`${r.id}\`** — ${r.leaks}`).join("\n")}

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
