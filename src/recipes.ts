/**
 * Recipes and their receipts.
 *
 * A recipe is a task someone actually needs to do. A receipt is the proof
 * that the recipe was run and what the chain said when it was. A recipe with
 * no receipt is reported as having no receipt, never as working.
 *
 * Recipes are split by what they cost to run:
 *
 *   read    - free, so the runner re-runs them on every scheduled run.
 *   pure    - no network at all.
 *   spend   - consumes testnet funds. Faucets give 0.125 TAZ/day (Valar) and
 *             1 TAZ/day (Fauzec), so these are budgeted, not hourly. Running
 *             them on a schedule would drain the wallet and then report red
 *             for lack of funds rather than for a real regression, which
 *             would make this project lie. headless-send sends to itself, so
 *             a run costs only the fee; it still only runs when asked
 *             (ZCASH_NOW_SPEND=1) from a machine that holds the wallet.
 *   human   - needs a person to approve in a wallet UI. Cannot be scheduled.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RECEIPTS_PATH = join(HERE, "..", "receipts.json");

export type RecipeCost = "read" | "pure" | "spend" | "human";

export interface Recipe {
  id: string;
  task: string;
  /** Keywords a caller might use for this task. */
  aliases: string[];
  cost: RecipeCost;
  /** Working code. Kept short enough that a reader can check it. */
  code: string;
  /** What the recipe proves when it passes. */
  proves: string;
  /**
   * What running this recipe gives away, and to whom. Stated per recipe
   * because a privacy note at the bottom of a README is easy to write and
   * easy to ignore; this travels with the code an agent is handed.
   */
  leaks: string;
  /** Rules from facts.ts that this recipe exists to keep honest. */
  rules: string[];
}

export interface Receipt {
  recipeId: string;
  /**
   * `network` is deliberately not `fail`: the light-wallet server or the path
   * to it did not answer, which says nothing about whether the recipe works.
   * Collapsing the two produces false reds, and a status board that cries
   * wolf is worse than no status board.
   */
  status: "pass" | "fail" | "network" | "skipped";
  ranAt: string;
  /** Chain height when it ran, so the receipt is anchored in time. */
  blockHeight?: number;
  /** Real transaction this recipe produced, where it produces one. */
  txid?: string;
  toolVersions?: Record<string, string>;
  detail?: string;
  error?: string;
  /**
   * Copied from an earlier run that this run did not repeat (a spend on a
   * read-only schedule). ranAt keeps the original time, so nothing looks
   * fresher than it is.
   */
  carried?: boolean;
}

export const RECIPES: Recipe[] = [
  {
    id: "chain-status",
    task: "Find out which chain I am on and whether NU7 is active",
    aliases: ["chain", "status", "height", "nu7 active", "which network", "branch id"],
    cost: "read",
    code: `import { chainStatus } from "zcash-now/chain";

const s = await chainStatus();
console.log(s.network, s.height, s.consensusBranchId, s.nu7.active);`,
    proves:
      "The light-wallet server answers, and NU7 activation is decided against " +
      "the height the chain reports rather than a constant in the code.",
    leaks:
      "The light-wallet server learns your IP address and that you asked for " +
      "chain state. Nothing about any wallet or address is sent.",
    rules: ["v4-disallowed", "expiry-120-not-40"],
  },
  {
    id: "standard-fee",
    task: "Get the current fee instead of hardcoding one",
    aliases: ["fee", "zip 317", "marginal fee", "how much does a transaction cost"],
    cost: "read",
    code: `import { getStandardFee } from "zcash-now/chain";

const r = await getStandardFee();
// estimatorVersion 0 means the static ZIP 317 marginal fee.
// UNIMPLEMENTED is a valid answer: let the SDK compute the fee instead.
console.log(r.available ? r.fee : r.reason);`,
    proves:
      "The fee comes from the server. A constant written today can be wrong " +
      "tomorrow, and ZIP 317 Revision 2 is still Proposed.",
    leaks:
      "The light-wallet server learns your IP address. The query carries no " +
      "address, amount or transaction.",
    rules: ["let-the-sdk-compute-fees"],
  },
  {
    id: "payment-request",
    task: "Ask for a shielded payment with an order ID in the memo",
    aliases: [
      "zip 321", "payment link", "payment uri", "invoice", "memo", "qr",
      "checkout", "order id", "request a payment", "take a payment",
      "receive a payment", "get paid", "charge", "bill",
    ],
    cost: "pure",
    code: `import { build, parse } from "zcash-now/zip321";

const uri = build([{
  address: "utest1...",
  amount: "0.125",
  memo: "order-1042",
  label: "Example Shop",
}], { network: "test" });

// Round-trip it: a URI you cannot parse is a URI a wallet may reject.
const back = parse(uri, { network: "test" });
console.log(uri, back.ok, back.payments[0].memo?.toString("utf8"));`,
    proves:
      "The URI satisfies the thirteen ZIP 321 validation rules and survives a " +
      "round trip, including base64url memo encoding with no padding.",
    leaks:
      "Nothing over the network: this runs offline. But the URI itself is the " +
      "leak surface. Anyone you hand it to sees the address, the amount and " +
      "the memo, and a memo is readable by every holder of the viewing key, " +
      "so put an opaque order id there and not a customer's name.",
    rules: ["six-hrps-not-one"],
  },
  {
    id: "fact-base-drift",
    task: "Check that the facts this server states still match the ZIPs",
    aliases: [
      "drift", "is this still true", "fact base", "zip status", "stale facts",
      "self check", "audit the facts",
    ],
    cost: "read",
    code: `import { checkFactBase } from "zcash-now/zipcheck";

// Anything asked of the chain cannot go stale. A *stated* fact can, so the
// stated ones are compared against the published ZIP index on every run.
const r = await checkFactBase();
if (r.drift.length) console.error(r.drift.map((d) => d.detail).join("\\n"));`,
    proves:
      "Every ZIP status this server asserts still matches zips.z.cash. When " +
      "one changes, this goes red and names the drift, instead of the fact " +
      "base quietly rotting.",
    leaks:
      "zips.z.cash learns the runner's IP address and that it fetched the " +
      "public index. No address, key or transaction is involved.",
    rules: [],
  },
  {
    id: "decode-address",
    task: "Check that an address is really usable, not just shaped right",
    aliases: [
      "validate address", "check address", "decode address", "unified address",
      "is this address valid", "f4jumble", "bech32m", "typecode", "receivers",
    ],
    cost: "pure",
    code: `import { decodeUnifiedAddress } from "zcash-now/address";

// Decoding, not prefix matching. A startsWith("utest1") check accepts a
// corrupted address and rejects valid Revision 2 forms (zu, tu).
const d = decodeUnifiedAddress(addr, { network: "test", height: tipHeight });

if (!d.valid) throw new Error(d.errors.join("; "));
console.log(d.revision, d.canReceiveShielded, d.senderShouldUse);
// There is no Ironwood receiver: 0x03 is Orchard, and that is the one to use.`,
    proves:
      "Bech32m, the F4Jumble inverse and ZIP 316 typecode parsing all agree, " +
      "and addresses that a prefix check would wave through are rejected.",
    leaks:
      "Nothing. This is offline arithmetic on the address itself; no server is " +
      "contacted and the address never leaves the process.",
    rules: ["six-hrps-not-one", "must-understand-metadata", "no-ironwood-receiver"],
  },
  {
    id: "verify-txid",
    task: "Confirm on chain that a payment really happened",
    aliases: ["verify", "txid", "confirm payment", "lookup transaction", "receipt"],
    cost: "read",
    code: `import { getTransaction } from "zcash-now/chain";

// The hex an explorer prints is the reverse of the bytes the gRPC call wants.
// getTransaction handles that; doing it by hand is the usual reason a valid
// txid "is not found".
const tx = await getTransaction(txidHex);
console.log("mined at height", tx.height, "bytes", tx.data.length);`,
    proves:
      "The transaction exists on the chain the server is serving, read over " +
      "gRPC rather than scraped from an explorer.",
    leaks:
      "The light-wallet server learns your IP address and exactly which " +
      "transaction you care about. That is a real disclosure, and it is why " +
      "this goes to a light-wallet server over TLS instead of to a " +
      "third-party explorer: one party instead of two. Routing it through Nym " +
      "would remove the IP, and has not been done yet.",
    rules: ["txid-byte-order", "payment-lifecycle"],
  },
  {
    id: "shielded-send",
    task: "Send a real shielded payment on testnet",
    aliases: [
      "send", "send a payment", "pay someone", "spend", "broadcast",
      "noir wallet", "transfer funds", "make a payment",
    ],
    cost: "human",
    code: `// Browser only. Noir Wallet testnet is a SEPARATE extension: load the
// -testnet.zip asset from release v1.0.39 or v1.0.40-beta unpacked via
// chrome://extensions. The v2.0.0-beta release ships no testnet zip.
import { getNoirWallet } from "@noir-wallet/sdk";

const wallet = getNoirWallet();
if (!wallet) throw new Error("Install the Noir Wallet testnet extension");

await wallet.zcash.connect();              // asks the user
const txid = await wallet.zcash.sendTransaction({
  to: "utest1...",
  amount: "0.01",
  memo: "order-1042",
  fundingSource: "shielded",
});                                        // asks the user again`,
    proves:
      "A shielded payment with a memo, broadcast to public testnet, returning " +
      "a txid that verify-txid can then confirm independently.",
    leaks:
      "On chain: nothing about amount, sender or receiver, which is the point " +
      "of a shielded payment. Off chain: the wallet's own light-wallet server " +
      "sees your IP and the moment you broadcast, which is a timing signal. " +
      "The memo is readable by every holder of the viewing key. And once the " +
      "txid is published as a receipt here, this particular payment is " +
      "publicly linked to this project, which is a disclosure we chose to " +
      "make and would not make with a real user's payment.",
    rules: ["pool-vs-protocol", "no-ironwood-receiver"],
  },
  {
    id: "headless-send",
    task: "Send a shielded payment with a memo from a script, no wallet UI",
    aliases: [
      "headless", "script", "cli", "backend", "server-side send", "automate",
      "zcash-devtool", "devtool", "send with memo", "memo", "bot", "agent payment",
    ],
    cost: "spend",
    code: `# zcash-devtool built from git (Ironwood/NU7 line). Signs locally, no UI.
git clone https://github.com/zcash/zcash-devtool && cd zcash-devtool
cargo build --release
B=target/release/zcash-devtool

# Once: a testnet wallet. The seed is encrypted to an age identity.
$B wallet -w ./wallet init --name demo -i ./wallet/identity.txt -n test
$B wallet -w ./wallet list-addresses      # fund this utest1... address

# Every run. -s zecrocks is testnet.zec.rocks:443 for a testnet wallet;
# add --connection tor to hide your IP from the light-wallet server.
$B wallet -w ./wallet sync -s zecrocks
$B wallet -w ./wallet send -i ./wallet/identity.txt \\
  --address utest1... --value 10000 --memo "order-1042" -s zecrocks
# prints the txid as its last line`,
    proves:
      "A shielded payment with a memo, signed and broadcast by a script with no " +
      "human in the loop, returning a txid that verify-txid confirms over gRPC.",
    leaks:
      "On chain: nothing about amount, sender or receiver; the memo is " +
      "encrypted. Off chain: testnet.zec.rocks sees the runner's IP and the " +
      "moment it broadcasts, unless ZCASH_NOW_CONNECTION=tor routes it over " +
      "Tor. The runner holds a testnet seed, which is a trust cost we accept " +
      "for testnet only. Publishing the txid links this payment to this " +
      "project, by choice.",
    rules: ["pool-vs-protocol", "no-ironwood-receiver"],
  },
  {
    id: "read-memo",
    task: "Receive a shielded payment and read its memo",
    aliases: [
      "read memo", "receive memo", "decrypt memo", "incoming memo",
      "list transactions", "sync wallet", "check payment arrived",
    ],
    cost: "read",
    code: `$B wallet -w ./wallet sync -s zecrocks
$B wallet -w ./wallet list-tx
# Each transaction prints its txid, "Mined: <height>" and every output's memo,
# decrypted locally. Use the text mode: --mode csv omits sends to yourself.`,
    proves:
      "The memo sent by headless-send was mined, found by trial decryption " +
      "and decrypted locally with the wallet's own keys.",
    leaks:
      "The light-wallet server sees the runner's IP and when it syncs. It " +
      "serves the same compact blocks to everyone, so it does not learn which " +
      "transactions are ours. The memo never leaves the machine.",
    rules: ["payment-lifecycle"],
  },
];

export const recipe = (id: string): Recipe | undefined =>
  RECIPES.find((r) => r.id === id);

/**
 * Which way the money moves, which the keyword overlap alone cannot tell:
 * "take a shielded payment" and "send a shielded payment" share almost every
 * word and want opposite recipes.
 */
const INBOUND = /\b(take|taking|receive|receiving|request|requesting|ask|accept|accepting|charge|bill|invoice|collect|get paid|incoming)\b/;
const OUTBOUND = /\b(send|sending|spend|spending|pay|paying|transfer|broadcast|outgoing)\b/;

const DIRECTION: Partial<Record<string, "in" | "out">> = {
  "payment-request": "in",
  "shielded-send": "out",
  "headless-send": "out",
};

/** Match a free-text task against the recipe list. */
export function findRecipes(query: string): Recipe[] {
  const q = query.toLowerCase().trim();
  if (!q) return RECIPES;

  // "pay me" / "pay to my address" is inbound despite containing "pay".
  const inbound = INBOUND.test(q) || /\bpay (me|us|my|our)\b/.test(q);
  const outbound = OUTBOUND.test(q) && !inbound;

  const scored = RECIPES.map((r) => {
    let score = 0;
    if (r.id === q) score += 100;
    if (r.task.toLowerCase().includes(q)) score += 50;
    for (const a of r.aliases) {
      if (a === q) score += 40;
      else if (q.includes(a) || a.includes(q)) score += 15;
    }
    for (const word of q.split(/\s+/).filter((w) => w.length > 3)) {
      if (r.task.toLowerCase().includes(word)) score += 8;
      if (r.aliases.some((a) => a.includes(word))) score += 5;
    }

    // Direction decides between the two payment recipes, and only those.
    const dir = DIRECTION[r.id];
    if (dir && score > 0) {
      if (inbound) score += dir === "in" ? 45 : -45;
      else if (outbound) score += dir === "out" ? 45 : -45;
    }

    return { r, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // A clear direction with no keyword overlap still tells us what is wanted:
  // "pay me to my utest address" shares no alias but is unambiguously inbound.
  if (scored.length === 0 && (inbound || outbound)) {
    const wanted = inbound ? "payment-request" : "shielded-send";
    const r = recipe(wanted);
    if (r) return [r];
  }

  return scored.map((s) => s.r);
}

export function loadReceipts(): Receipt[] {
  try {
    const parsed = JSON.parse(readFileSync(RECEIPTS_PATH, "utf8"));
    return Array.isArray(parsed?.receipts) ? parsed.receipts : [];
  } catch {
    return [];
  }
}

export function receiptFor(recipeId: string): Receipt | undefined {
  return loadReceipts()
    .filter((r) => r.recipeId === recipeId)
    .sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1))[0];
}

/**
 * How a recipe should be described to a caller, given whether it has a
 * receipt. The honest default is "no receipt yet".
 */
export function describeReceipt(recipeId: string): string {
  const r = receiptFor(recipeId);
  if (!r)
    return (
      "No receipt yet: this recipe has not been run by the scheduled runner. " +
      "Treat the code as unverified."
    );

  const bits = [`${r.status} at ${r.ranAt}`];
  if (r.blockHeight !== undefined) bits.push(`block ${r.blockHeight}`);
  if (r.txid) bits.push(`txid ${r.txid}`);
  if (r.toolVersions)
    bits.push(
      Object.entries(r.toolVersions)
        .map(([k, v]) => `${k} ${v}`)
        .join(", "),
    );
  if (r.detail) bits.push(r.detail);
  if (r.error) bits.push(`error: ${r.error}`);
  return bits.join(" | ");
}
