/**
 * Verified ground truth about current Zcash consensus and tooling.
 *
 * Every entry carries provenance: the ZIP or repo it came from, that
 * source's own status, and the date it was checked. Nothing in this file
 * is asserted from memory. Anything that can be asked of the live chain
 * instead of stated here belongs in chain.ts, not here.
 */

export const CHECKED_ON = "2026-11-04";

export type ZipStatus =
  | "Final"
  | "Active"
  | "Proposed"
  | "Draft"
  | "Reserved"
  | "Withdrawn"
  | "Obsolete";

export interface Zip {
  zip: string;
  title: string;
  status: ZipStatus | string;
  url: string;
  partOf?: string;
  note?: string;
}

/** Severity of getting a rule wrong. `funds` means money can be lost. */
export type Impact = "funds" | "privacy" | "invalid" | "stale";

export interface Rule {
  id: string;
  /** The claim, stated so it can be checked. */
  claim: string;
  /** Why an agent gets this wrong today. */
  trap: string;
  impact: Impact[];
  sources: string[];
}

// ---------------------------------------------------------------------------
// Network upgrades
// ---------------------------------------------------------------------------

export const UPGRADES = {
  nu63: {
    name: "NU6.3",
    codename: "Ironwood",
    zip: "258",
    status: "Final" as ZipStatus,
    mainnetActivationHeight: 3_428_143,
    mainnetActivationDate: "2026-07-28",
    why:
      "A soundness flaw in the Orchard proof circuit could have allowed " +
      "creating counterfeit ZEC with no on-chain trace. NU6.3 seals Orchard " +
      "and introduces the Ironwood pool behind a turnstile that caps " +
      "withdrawals to verifiable deposits.",
  },
  nu7: {
    name: "NU7",
    zip: "259",
    status: "Proposed" as ZipStatus,
    withdrawnPredecessor: "254",
    testnetActivationHeight: 4_465_026,
    testnetActivationDate: "2026-10-06",
    mainnetActivationHeight: 3_543_405,
    mainnetHeightDecidedOn: "2026-10-20",
    mainnetHeightDecidedIn: "https://github.com/zcash/zips/pull/1405",
    mainnetEstimate: "2026-11-06T00:45Z/2026-11-06T02:35Z",
    /**
     * A claim still in circulation. Developer material written before
     * 2026-10-20 says mainnet activation is unscheduled; the height was
     * decided that day. This is the shape of the problem this server
     * exists for: the rule changed, the documents did not.
     */
    commonStaleClaim: "Mainnet activation isn't scheduled yet",
  },
} as const;

// ---------------------------------------------------------------------------
// ZIPs that a wallet or payment integration must actually read
// ---------------------------------------------------------------------------

export const ZIPS: Zip[] = [
  {
    zip: "258",
    title: "Deployment of the NU6.3 Network Upgrade",
    status: "Final",
    url: "https://zips.z.cash/zip-0258",
  },
  {
    zip: "259",
    title: "Deployment of the NU7 Network Upgrade",
    status: "Proposed",
    url: "https://zips.z.cash/zip-0259",
  },
  {
    zip: "254",
    title: "Deployment of the NU7 Network Upgrade",
    status: "Withdrawn",
    url: "https://zips.z.cash/zip-0254",
    note: "Withdrawn. Superseded by ZIP 259. Material citing 254 is stale.",
  },
  {
    zip: "218",
    title: "25-second Block Target Spacing",
    status: "Proposed",
    url: "https://zips.z.cash/zip-0218",
    partOf: "NU7",
  },
  {
    zip: "2003",
    title: "Disallow version 4 transactions",
    status: "Proposed",
    url: "https://zips.z.cash/zip-2003",
    partOf: "NU7",
  },
  {
    zip: "235",
    title: "Remove 60% of Transaction Fees From Circulation",
    status: "Proposed",
    url: "https://zips.z.cash/zip-0235",
    partOf: "NU7",
  },
  {
    zip: "237",
    title: "Network Sustainability Mechanism: Halving-Preserving Issuance",
    status: "Proposed",
    url: "https://zips.z.cash/zip-0237",
    partOf: "NU7",
  },
  {
    zip: "326",
    title: "NU6.3 Consequences for Wallets",
    status: "Draft",
    url: "https://zips.z.cash/zip-0326",
    note: "The single most important document for wallet correctness after NU6.3.",
  },
  {
    zip: "318",
    title: "Orchard to Ironwood Migration",
    status: "Draft",
    url: "https://zips.z.cash/zip-0318",
  },
  {
    zip: "2006",
    title: "Restricting Transfers into the Orchard Pool",
    status: "Final",
    url: "https://zips.z.cash/zip-2006",
  },
  {
    zip: "2005",
    title: "Ironwood Quantum Recoverability",
    status: "Proposed",
    url: "https://zips.z.cash/zip-2005",
  },
  {
    zip: "224",
    title: "Orchard Shielded Protocol",
    status: "Final",
    url: "https://zips.z.cash/zip-0224",
  },
  {
    zip: "316",
    title: "Unified Addresses and Unified Viewing Keys",
    status: "Revision 0: Active; Revision 1: Withdrawn; Revision 2: Draft",
    url: "https://zips.z.cash/zip-0316",
  },
  {
    zip: "317",
    title: "Proportional Transfer Fee Mechanism",
    status: "Revision 0: Active; Revision 1 (NU6.3): Active; Revision 2: Proposed",
    url: "https://zips.z.cash/zip-0317",
  },
  {
    zip: "2009",
    title: "Reduce Marginal Fee to 1000 Zatoshis and Raise the Weight Ratio Cap to 10",
    status: "Proposed",
    url: "https://zips.z.cash/zip-2009",
    note: "NOT part of NU7, and non-consensus. Do not describe it as an NU7 rule.",
  },
  {
    zip: "321",
    title: "Payment Request URIs",
    status: "Active",
    url: "https://zips.z.cash/zip-0321",
  },
  {
    zip: "225",
    title: "Version 5 Transaction Format",
    status: "Final",
    url: "https://zips.z.cash/zip-0225",
  },
  {
    zip: "229",
    title: "Version 6 Transaction Format",
    status: "Draft",
    url: "https://zips.z.cash/zip-0229",
  },
];

export const zip = (n: string): Zip | undefined => ZIPS.find((z) => z.zip === n);

// ---------------------------------------------------------------------------
// The rules agents get wrong. Ordered by what it costs to be wrong.
// ---------------------------------------------------------------------------

export const RULES: Rule[] = [
  {
    id: "no-ironwood-receiver",
    claim:
      "There is no Ironwood receiver type, no Ironwood address format and no " +
      "Ironwood encoding. Typecode 0x03 is still named Orchard, and the same " +
      "incoming viewing key scans both the Orchard and Ironwood pools, " +
      "because receivers are scoped to the Orchard *protocol*, not to a pool.",
    trap:
      "Code that looks for an Ironwood receiver to decide whether an address " +
      "can receive shielded funds will never find one, and will reject valid " +
      "addresses. The Orchard receiver is how Ironwood funds are received " +
      "after NU6.3.",
    impact: ["invalid"],
    sources: ["https://zips.z.cash/zip-0326", "https://zips.z.cash/zip-0316"],
  },
  {
    id: "pool-vs-protocol",
    claim:
      "After NU6.3 activation, never send to an external Orchard-*pool* " +
      "receiver, including the wallet's own; instead pay external " +
      "Orchard-*protocol* receivers into the Ironwood pool.",
    trap:
      "The distinction is one word and it decides whether a payment is " +
      "valid. ZIP 326 lists getting it wrong as potential loss of funds, and " +
      "as a privacy leak: a holder of the receiver's ivk can decrypt the note.",
    impact: ["funds", "privacy", "invalid"],
    sources: ["https://zips.z.cash/zip-0326", "https://zips.z.cash/zip-2006"],
  },
  {
    id: "expiry-120-not-40",
    claim:
      "From NU7 activation a transaction expires 120 blocks after its target " +
      "height, not 40.",
    trap:
      "Every pre-NU7 example hardcodes 40. Repeating it changes when the " +
      "transaction stops being mineable.",
    impact: ["invalid", "stale"],
    sources: [
      "https://github.com/zcash/librustzcash/blob/main/zcash_client_backend/CHANGELOG.md (zcash_client_backend 0.25.0, 2026-10-21)",
    ],
  },
  {
    id: "v4-disallowed",
    claim: "NU7 disallows version 4 transactions (ZIP 2003).",
    trap:
      "Tutorials and libraries that still build v4 produce transactions that " +
      "cannot be mined once NU7 is active.",
    impact: ["invalid", "stale"],
    sources: ["https://zips.z.cash/zip-2003"],
  },
  {
    id: "must-understand-metadata",
    claim:
      "Unified address metadata typecodes 0xE0 (expiry height), 0xE1 (expiry " +
      "time) and the unassigned range 0xE2..=0xFC are MUST-understand: a " +
      "parser that does not understand them must reject the whole address. " +
      "Revision 0 addresses must not contain them at all.",
    trap:
      "The natural reflex is to ignore unknown items, which is correct only " +
      "for non-MUST-understand items. An ignoring parser silently accepts " +
      "expired addresses.",
    impact: ["funds", "invalid"],
    sources: ["https://zips.z.cash/zip-0316"],
  },
  {
    id: "six-hrps-not-one",
    claim:
      "Unified addresses do not all start with u or utest. Revision 0 uses u " +
      "(mainnet) and utest (testnet). Revision 2 adds zu and zutest for " +
      "shielded-only addresses, which must not contain transparent items, " +
      "and tu and tutest for transparent-enabled ones.",
    trap:
      "Validators written as a startsWith check on u1 or utest1 reject valid " +
      "Revision 2 addresses.",
    impact: ["invalid"],
    sources: ["https://zips.z.cash/zip-0316"],
  },
  {
    id: "orchard-sealed",
    claim:
      "Orchard is sealed: NU6.3 prevents transactions from creating new " +
      "Orchard outputs. Migration to Ironwood is one-way, user-initiated, has " +
      "no deadline, and spends exactly one Orchard note to produce exactly " +
      "one Ironwood output (ZIP 318).",
    trap:
      "Guides that say to use Orchard predate NU6.3. Funds do not migrate on " +
      "their own.",
    impact: ["stale"],
    sources: ["https://zips.z.cash/zip-0318", "https://zips.z.cash/zip-2006"],
  },
  {
    id: "let-the-sdk-compute-fees",
    claim:
      "Fees follow ZIP 317, whose Revision 1 (NU6.3) is Active. A proposal " +
      "targeting NU6.3 or later counts one action per Orchard spend or " +
      "output. Ask the SDK, or the light-wallet server's GetStandardFee; do " +
      "not hardcode.",
    trap:
      "Hardcoded fees were already wrong before NU6.3. ZIP 2009 (marginal fee " +
      "1000 zatoshis, weight ratio cap 10) is Proposed, non-consensus, and " +
      "NOT part of NU7 -- citing it as an NU7 rule is a common error.",
    impact: ["invalid", "stale"],
    sources: [
      "https://zips.z.cash/zip-0317",
      "https://zips.z.cash/zip-2009",
      "https://github.com/zcash/librustzcash/blob/main/zcash_client_backend/CHANGELOG.md (0.24.0, 2026-08-18)",
    ],
  },
  {
    id: "dummy-output-ciphertexts",
    claim:
      "When rebalancing within the Orchard pool, a dummy output's " +
      "enc_ciphertext must be filled with random bytes.",
    trap:
      "Using a real ciphertext on a dummy output lets anyone holding the " +
      "receiver's ivk link a spend to an address.",
    impact: ["privacy"],
    sources: ["https://zips.z.cash/zip-0326"],
  },
  {
    id: "payment-lifecycle",
    claim:
      "Treat a payment as seen, then mined, then confirmed. NU7 targets " +
      "25-second block spacing (ZIP 218, Proposed), which is a target, not a " +
      "promise that a payment is done in 25 seconds.",
    trap:
      "Code that reports success on first sight of a transaction reports " +
      "success too early.",
    impact: ["invalid"],
    sources: ["https://zips.z.cash/zip-0218"],
  },
];

export const rule = (id: string): Rule | undefined =>
  RULES.find((r) => r.id === id);

// ---------------------------------------------------------------------------
// Unified address typecodes (ZIP 316)
// ---------------------------------------------------------------------------

export interface Typecode {
  code: number;
  name: string;
  shielded: boolean;
  mustUnderstand: boolean;
  revisions: string[];
}

export const TYPECODES: Typecode[] = [
  { code: 0x00, name: "Transparent P2PKH", shielded: false, mustUnderstand: false, revisions: ["R0", "R2-tu"] },
  { code: 0x01, name: "Transparent P2SH", shielded: false, mustUnderstand: false, revisions: ["R0", "R2-tu"] },
  { code: 0x02, name: "Sapling", shielded: true, mustUnderstand: false, revisions: ["R0", "R2-zu", "R2-tu"] },
  { code: 0x03, name: "Orchard", shielded: true, mustUnderstand: false, revisions: ["R0", "R2-zu", "R2-tu"] },
  { code: 0xe0, name: "Address Expiry Height", shielded: false, mustUnderstand: true, revisions: ["R2-zu", "R2-tu"] },
  { code: 0xe1, name: "Address Expiry Time", shielded: false, mustUnderstand: true, revisions: ["R2-zu", "R2-tu"] },
];

export const typecode = (code: number): Typecode | undefined =>
  TYPECODES.find((t) => t.code === code);

/**
 * Classify a typecode that is not in the registry above.
 * ZIP 316: 0xC0..=0xDF are non-MUST-understand metadata (ignorable);
 * 0xE2..=0xFC are unassigned MUST-understand metadata (reject);
 * 0xFFFA..=0xFFFF are experimental.
 */
export function classifyUnknownTypecode(code: number): {
  mustUnderstand: boolean;
  kind: string;
} {
  if (code >= 0xc0 && code <= 0xdf)
    return { mustUnderstand: false, kind: "non-MUST-understand metadata" };
  if (code >= 0xe2 && code <= 0xfc)
    return { mustUnderstand: true, kind: "unassigned MUST-understand metadata" };
  if (code >= 0xfffa && code <= 0xffff)
    return { mustUnderstand: false, kind: "experimental" };
  return { mustUnderstand: false, kind: "unassigned" };
}

/** Human-readable prefixes, by revision and kind. */
export const HRPS = {
  ua: {
    r0: { main: "u", test: "utest" },
    r2ShieldedOnly: { main: "zu", test: "zutest" },
    r2TransparentEnabled: { main: "tu", test: "tutest" },
  },
  ufvk: { r0: { main: "uview", test: "uviewtest" }, r2: { main: "uvf", test: "uvftest" } },
  uivk: { r0: { main: "uivk", test: "uivktest" }, r2: { main: "uvi", test: "uvitest" } },
} as const;

/** Sender preference order, most preferred first (ZIP 316). */
export const SENDER_PREFERENCE = [0x03, 0x02, 0x01, 0x00];

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const ENDPOINTS = {
  testnet: "testnet.zec.rocks:443",
  dead: [
    { host: "lightwalletd.testnet.electriccoin.co", why: "Dead. Retired light-wallet server." },
    { host: "testnet.lightwalletd.com", why: "Dead. Retired light-wallet server." },
  ],
  faucets: [
    { name: "Valar", url: "https://faucet.testnet.valargroup.dev/", limit: "0.125 TAZ per day per network" },
    { name: "Fauzec", url: "https://fauzec.com/", limit: "1 TAZ per day per address" },
  ],
} as const;

// ---------------------------------------------------------------------------
// Tool status. The "broken" entries are the hours this project exists to save.
// ---------------------------------------------------------------------------

export interface Tool {
  name: string;
  status: "works" | "broken" | "needs-toolchain" | "human-gated";
  what: string;
  why: string;
  url?: string;
  checkedOn: string;
}

export const TOOLS: Tool[] = [
  {
    name: "@noir-wallet/sdk",
    status: "human-gated",
    what: "Browser-extension wallet. Sends real shielded testnet payments and returns a txid.",
    why:
      "Published on npm at 0.1.9. Browser-only, wraps window.noirwallet. " +
      "sendTransaction({to, amount, memo, fundingSource: shielded}) returns a " +
      "txid but requires human approval, so it cannot run headless. Testnet is " +
      "a SEPARATE extension loaded unpacked: use the -testnet.zip asset from " +
      "v1.0.39 or v1.0.40-beta. The v2.0.0-beta release ships no testnet zip. " +
      "switchNetwork() always throws.",
    url: "https://github.com/NoirWallet/noir-wallet-sdk",
    checkedOn: CHECKED_ON,
  },
  {
    name: "zcash/lightwallet-protocol",
    status: "works",
    what: "The gRPC service definition for light-wallet servers: CompactTxStreamer, 21 methods.",
    why:
      "service.proto and compact_formats.proto, tagged v0.6.0. GetLightdInfo " +
      "returns chainName, consensusBranchId and blockHeight, which is how you " +
      "ask the chain what it is instead of hardcoding it. GetTaddressTxids is " +
      "deprecated in favour of GetTaddressTransactions, and GetBlockNullifiers " +
      "in favour of GetBlockRange with poolTypes.",
    url: "https://github.com/zcash/lightwallet-protocol",
    checkedOn: CHECKED_ON,
  },
  {
    name: "librustzcash (zcash_client_backend)",
    status: "works",
    what: "The reference Rust implementation. Ironwood and NU7 are implemented.",
    why:
      "0.24.0 (2026-08-18) added ShieldedPool naming Ironwood alongside Sapling " +
      "and Orchard, ChangeValue::ironwood, Ironwood tracked as a distinct pool, " +
      "and a zip318 module. 0.25.0 (2026-10-21) changed expiry to 120 blocks " +
      "after target height when NU7 is active.",
    url: "https://github.com/zcash/librustzcash",
    checkedOn: CHECKED_ON,
  },
  {
    name: "zingolib",
    status: "needs-toolchain",
    what: "Rust wallet library. The plausible path to headless shielded sending.",
    why:
      "8.0.0, pins zcash_client_backend =0.25.0, so it is on the Ironwood and " +
      "NU7 line. Also ships zingo-nym-proxy-ffi for network privacy. Build from " +
      "git: the zingo-cli published on crates.io is 0.5.0 while zingolib is " +
      "8.0.0, so the published CLI is stale.",
    url: "https://github.com/zingolabs/zingolib",
    checkedOn: CHECKED_ON,
  },
  {
    name: "zcash-devtool",
    status: "needs-toolchain",
    what: "Stateless CLI wallet for prototyping.",
    why:
      "Not published on crates.io and ships no binaries: cargo run only. Its " +
      "own README says DO NOT USE THIS IN PRODUCTION and never mentions NU7 or " +
      "Ironwood. Testnet via -n test.",
    url: "https://github.com/zcash/zcash-devtool",
    checkedOn: CHECKED_ON,
  },
  {
    name: "@chainsafe/webzjs-wallet (WebZjs)",
    status: "broken",
    what: "Browser wallet via WASM.",
    why:
      "Not published on npm, and no Ironwood support. Building it needs Rust " +
      "nightly, wasm-pack, just, yarn and a gRPC-web proxy. Do not build on it " +
      "for NU7.",
    checkedOn: CHECKED_ON,
  },
  {
    name: "zecli / zcli",
    status: "broken",
    what: "CLI wallet.",
    why:
      "zecli 0.6.0 on crates.io makes Orchard-only addresses, which cannot " +
      "receive funds. zcli is a 0.0.0 placeholder. The git version of zcli " +
      "needs a zidecar server and none is hosted for testnet.",
    checkedOn: CHECKED_ON,
  },
  {
    name: "zallet / zecd",
    status: "broken",
    what: "Server-side wallet with RPC.",
    why: "No NU7 release. zallet on crates.io is a 0.0.0 placeholder.",
    checkedOn: CHECKED_ON,
  },
  {
    name: "@zcash/sdk",
    status: "broken",
    what: "TypeScript payment-link and QR layer.",
    why:
      "Recommended in circulating material but not published on npm. " +
      "Implement ZIP 321 directly instead; it is a URI spec.",
    checkedOn: CHECKED_ON,
  },
  {
    name: "@frontiercompute/zcash-mcp",
    status: "works",
    what: "An existing Zcash MCP server, 28 tools, oriented to ZAP1 attestations and receipts.",
    why:
      "Published at 1.4.0. Complementary, not overlapping: it declares it is " +
      "not a wallet MCP and excludes keys, balance scanning and shielded spend " +
      "construction. It needs a Zebra node and the ZAP1 API, and mentions none " +
      "of NU7, NU6.3, Ironwood or Orchard.",
    url: "https://github.com/Frontier-Compute/zcash-mcp",
    checkedOn: CHECKED_ON,
  },
];

export const tool = (name: string): Tool | undefined =>
  TOOLS.find((t) => t.name.toLowerCase().includes(name.toLowerCase()));
