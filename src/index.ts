#!/usr/bin/env node
/**
 * zcash-now: an MCP server that keeps a coding agent on current Zcash.
 *
 * Design rule: anything the chain can answer is asked, not stated. Anything
 * stated carries its source, that source's status, and the date it was
 * checked. A recipe with no receipt says so.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  CHECKED_ON,
  ENDPOINTS,
  RULES,
  TOOLS,
  TYPECODES,
  UPGRADES,
  ZIPS,
  classifyUnknownTypecode,
  rule,
  tool as findTool,
  type Impact,
} from "./facts.js";
import { chainStatus, getStandardFee, getTransaction, closeChain } from "./chain.js";
import { lint, summarize } from "./lint.js";
import { explain } from "./errors.js";
import { build, parse, ENFORCED_RULES } from "./zip321.js";
import { RECIPES, describeReceipt, findRecipes } from "./recipes.js";

const server = new McpServer({ name: "zcash-now", version: "0.1.0" });

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

// ---------------------------------------------------------------------------
// Live chain
// ---------------------------------------------------------------------------

server.registerTool(
  "chain_status",
  {
    title: "Ask the chain what it is",
    description:
      "Queries a light-wallet server over gRPC for the current network, tip " +
      "height, consensus branch id and sync state, and computes whether NU7 is " +
      "active at that height. Use this instead of assuming a network or an " +
      "activation height.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return json(await chainStatus());
    } catch (e: any) {
      return text(
        `Could not reach ${ENDPOINTS.testnet}: ${e?.code ?? ""} ${e?.message ?? e}\n\n` +
          explain(String(e?.code ?? e?.message ?? e))
            .map((x) => `${x.id}: ${x.cause}\n  fix: ${x.fix}`)
            .join("\n"),
      );
    }
  },
);

server.registerTool(
  "standard_fee",
  {
    title: "Get the current fee, do not hardcode one",
    description:
      "Asks the light-wallet server for the standard fee per logical action. " +
      "estimatorVersion 0 means the static ZIP 317 marginal fee. An " +
      "UNIMPLEMENTED answer is valid and means the SDK should compute the fee.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => json(await getStandardFee()),
);

server.registerTool(
  "verify_transaction",
  {
    title: "Confirm a transaction on chain",
    description:
      "Looks a txid up over gRPC and reports the height it was mined at. " +
      "Handles the byte-order reversal between the hex an explorer prints and " +
      "the bytes the gRPC call expects, which is the usual reason a valid txid " +
      "appears not to exist.",
    inputSchema: {
      txid: z.string().describe("Transaction id as 64 hex characters, as an explorer prints it."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ txid }) => {
    try {
      const tx = await getTransaction(txid);
      const height = Number(tx.height);
      return json({
        txid,
        found: true,
        minedAtHeight: height > 0 ? height : null,
        rawBytes: tx.data?.length ?? 0,
        note:
          height > 0
            ? "Mined. Treat a payment as seen, then mined, then confirmed: wait " +
              "for more blocks before treating a large amount as settled."
            : "Known to the server but not mined on the main chain yet.",
        checkedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      const msg = String(e?.details ?? e?.message ?? e);
      return json({
        txid,
        found: false,
        error: msg,
        explanations: explain(`${e?.code ?? ""} ${msg}`),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Stated facts, with provenance
// ---------------------------------------------------------------------------

server.registerTool(
  "zcash_rules",
  {
    title: "The NU6.3 and NU7 rules agents get wrong",
    description:
      "Returns the current consensus rules that changed under NU6.3 (Ironwood) " +
      "and NU7, each with the trap it creates, what it costs to get wrong, and " +
      "its source. Filter by impact to see only the ones that can cost funds or " +
      "leak privacy.",
    inputSchema: {
      impact: z
        .enum(["funds", "privacy", "invalid", "stale"])
        .optional()
        .describe("Only return rules with this impact."),
      id: z.string().optional().describe("Return one rule by its id."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ impact, id }) => {
    if (id) {
      const r = rule(id);
      return r ? json(r) : text(`No rule with id "${id}". Call zcash_rules with no arguments to list them.`);
    }
    const rules = impact ? RULES.filter((r) => r.impact.includes(impact as Impact)) : RULES;
    return json({
      checkedOn: CHECKED_ON,
      upgrades: UPGRADES,
      count: rules.length,
      rules,
      caveat:
        "These are the known regressions, not a complete specification. " +
        "ZIP 326 is the document to read for wallet correctness after NU6.3.",
    });
  },
);

server.registerTool(
  "zcash_zips",
  {
    title: "ZIPs that matter, with their current status",
    description:
      "The ZIPs a wallet or payment integration must actually read, each with " +
      "its own status. Status matters: ZIP 254 is Withdrawn in favour of 259, " +
      "and ZIP 2009 is Proposed and non-consensus, so citing either as a " +
      "current NU7 rule is wrong.",
    inputSchema: {
      zip: z.string().optional().describe("A ZIP number, for example 326."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ zip: n }) => {
    if (n) {
      const found = ZIPS.find((z) => z.zip === n.replace(/^zip-?/i, ""));
      return found ? json(found) : text(`ZIP ${n} is not in this list. See https://zips.z.cash/`);
    }
    return json({ checkedOn: CHECKED_ON, zips: ZIPS });
  },
);

server.registerTool(
  "typecodes",
  {
    title: "Unified address typecodes and prefixes",
    description:
      "The ZIP 316 typecode registry and what a parser must do with each. " +
      "There is no Ironwood typecode: 0x03 is still named Orchard and is how " +
      "Ironwood funds are received after NU6.3.",
    inputSchema: {
      code: z.number().int().optional().describe("Classify one typecode, for example 224 for 0xE0."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ code }) => {
    if (code !== undefined) {
      const known = TYPECODES.find((t) => t.code === code);
      return json(
        known ?? { code, ...classifyUnknownTypecode(code), knownName: null },
      );
    }
    return json({
      typecodes: TYPECODES,
      unknownRanges: [
        { range: "0xC0..=0xDF", ...classifyUnknownTypecode(0xc0) },
        { range: "0xE2..=0xFC", ...classifyUnknownTypecode(0xe2) },
        { range: "0xFFFA..=0xFFFF", ...classifyUnknownTypecode(0xfffa) },
      ],
      prefixes: {
        revision0: "u (mainnet), utest (testnet)",
        revision2ShieldedOnly: "zu, zutest -- must not contain transparent items",
        revision2TransparentEnabled: "tu, tutest",
        viewingKeys: "uview/uviewtest and uivk/uivktest (R0); uvf/uvftest and uvi/uvitest (R2)",
      },
      senderPreference: "Orchard (0x03) over Sapling (0x02) over transparent (0x01, 0x00)",
    });
  },
);

// ---------------------------------------------------------------------------
// Recipes, tools, errors
// ---------------------------------------------------------------------------

server.registerTool(
  "recipe_that_works",
  {
    title: "A recipe that is known to run today",
    description:
      "Given a task in plain words, returns working code plus the receipt from " +
      "the last time it was run against testnet: when, at what block height, " +
      "and the txid where the recipe produces one. A recipe with no receipt is " +
      "reported as unverified rather than as working.",
    inputSchema: {
      task: z
        .string()
        .describe('What you are trying to do, for example "take a shielded payment with an order id".'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ task }) => {
    const matches = findRecipes(task);
    if (matches.length === 0)
      return json({
        task,
        matched: null,
        available: RECIPES.map((r) => ({ id: r.id, task: r.task, cost: r.cost })),
        note: "No recipe matched. The available tasks are listed above.",
      });

    return json(
      matches.slice(0, 3).map((r) => ({
        id: r.id,
        task: r.task,
        cost: r.cost,
        costMeaning: {
          read: "Free. Re-run on every scheduled run.",
          pure: "No network at all.",
          spend: "Consumes testnet funds, so it is budgeted rather than scheduled.",
          human: "Needs a person to approve in a wallet UI, so it cannot be scheduled.",
        }[r.cost],
        code: r.code,
        proves: r.proves,
        receipt: describeReceipt(r.id),
        relatedRules: r.rules.map((id) => ({ id, claim: rule(id)?.claim })),
      })),
    );
  },
);

server.registerTool(
  "tool_status",
  {
    title: "Does this Zcash tool work today",
    description:
      "Whether a Zcash library, SDK or CLI works right now, and why, with the " +
      "date it was checked. The broken entries are the hours this server exists " +
      "to save: several are still widely recommended.",
    inputSchema: {
      name: z
        .string()
        .optional()
        .describe('Tool or package name, for example "webzjs" or "noir".'),
      status: z
        .enum(["works", "broken", "needs-toolchain", "human-gated"])
        .optional()
        .describe("Filter by status."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ name, status }) => {
    if (name) {
      const t = findTool(name);
      return t
        ? json(t)
        : json({
            query: name,
            found: false,
            note: "Not in this list, which means it has not been checked, not that it works.",
            known: TOOLS.map((x) => x.name),
          });
    }
    const list = status ? TOOLS.filter((t) => t.status === status) : TOOLS;
    return json({ checkedOn: CHECKED_ON, count: list.length, tools: list });
  },
);

server.registerTool(
  "explain_error",
  {
    title: "What this Zcash error actually means",
    description:
      "Maps an error message onto its cause. Many Zcash errors name a symptom " +
      "while the cause is a consensus change or an unpublished package, and the " +
      "message says nothing about either. Also reports when the cause is not in " +
      "your code.",
    inputSchema: {
      message: z.string().describe("The error message, stack line, or gRPC status."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ message }) => {
    const found = explain(message);
    if (found.length === 0)
      return json({
        message,
        matched: 0,
        note:
          "No known cause matched. Try chain_status to rule out the network, " +
          "tool_status for the packages involved, and lint_zcash_code on the " +
          "code that produced it.",
      });
    return json({ message, matched: found.length, explanations: found });
  },
);

server.registerTool(
  "lint_zcash_code",
  {
    title: "Find Zcash code that is no longer correct",
    description:
      "Scans code for patterns that were correct before NU6.3 or NU7 and are " +
      "not correct now: retired endpoints, version 4 transactions, hardcoded " +
      "fees, the old 40-block expiry, prefix-matched addresses, ignored " +
      "MUST-understand metadata, and packages that are not published. Findings " +
      "are ordered worst first and each cites its source.",
    inputSchema: {
      code: z.string().describe("Source code to scan. Any language."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ code }) => {
    const findings = lint(code);
    return text(`${summarize(findings)}\n\n${JSON.stringify({ findings }, null, 2)}`);
  },
);

// ---------------------------------------------------------------------------
// ZIP 321
// ---------------------------------------------------------------------------

server.registerTool(
  "payment_request",
  {
    title: "Build a ZIP 321 payment request",
    description:
      "Builds a zcash: payment URI that satisfies the ZIP 321 validation rules, " +
      "and refuses to emit one a conforming parser would reject. Memos are " +
      "base64url with no padding, and a memo on a transparent address is " +
      "rejected rather than silently dropped.",
    inputSchema: {
      address: z.string().describe("Recipient address. Unified, Sapling or transparent."),
      amount: z.string().optional().describe('Decimal ZEC as a string, for example "0.125". Never a float.'),
      memo: z.string().optional().describe("Memo text. Shielded recipients only, 512 bytes once encoded."),
      label: z.string().optional().describe("Recipient display name."),
      message: z.string().optional().describe("Message shown to the payer."),
      network: z.enum(["main", "test"]).optional().describe("Reject the address if it is for the other network."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ address, amount, memo, label, message, network }) => {
    try {
      const uri = build([{ address, amount, memo, label, message }], { network });
      const back = parse(uri, { network });
      return json({
        uri,
        roundTripped: back.ok,
        roundTripErrors: back.errors,
        enforcedRules: ENFORCED_RULES,
      });
    } catch (e: any) {
      return json({ error: e.message, explanations: explain(e.message) });
    }
  },
);

server.registerTool(
  "parse_payment_request",
  {
    title: "Validate a ZIP 321 payment request",
    description:
      "Parses a zcash: URI and reports every rule it breaks. Enforces the " +
      "thirteen ZIP 321 validation rules, including the ones an implementation " +
      "written from memory usually misses.",
    inputSchema: {
      uri: z.string().describe("The zcash: URI to validate."),
      network: z.enum(["main", "test"]).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ uri, network }) => {
    const r = parse(uri, { network });
    return json({
      ok: r.ok,
      errors: r.errors,
      payments: r.payments.map((p) => ({
        ...p,
        memo: p.memo ? { utf8: p.memo.toString("utf8"), bytes: p.memo.length } : undefined,
      })),
      enforcedRules: ENFORCED_RULES,
    });
  },
);

// ---------------------------------------------------------------------------

async function main() {
  await server.connect(new StdioServerTransport());
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    closeChain();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("zcash-now failed to start:", e);
  process.exit(1);
});
