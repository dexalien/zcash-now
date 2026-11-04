/**
 * Maps the error messages Zcash builders actually hit onto their cause.
 *
 * These are the moments where someone loses an hour: the message names a
 * symptom, the cause is a consensus or packaging change, and nothing in the
 * message says so.
 */

export interface Explanation {
  id: string;
  cause: string;
  fix: string;
  sources: string[];
  /** True when the cause is outside the caller's code. */
  notYourFault?: boolean;
}

interface Entry extends Explanation {
  match: RegExp;
}

const ENTRIES: Entry[] = [
  {
    id: "grpc-unimplemented-standard-fee",
    match: /UNIMPLEMENTED|12 UNIMPLEMENTED|getstandardfee/i,
    cause:
      "GetStandardFee needs a backend that implements the getstandardfee RPC. " +
      "A backend without it answers UNIMPLEMENTED.",
    fix:
      "This is a valid answer, not a bug in your call. Let your SDK compute the " +
      "ZIP 317 fee instead, and do not fall back to a hardcoded constant.",
    sources: ["zcash/lightwallet-protocol v0.6.0, rpc GetStandardFee"],
    notYourFault: true,
  },
  {
    id: "txid-not-found",
    match: /(transaction|tx).{0,20}(not found|does not exist)|NOT_FOUND|5 NOT_FOUND/i,
    cause:
      "The most common cause is byte order. TxFilter.hash takes the txid in " +
      "internal byte order, which is the reverse of the hex an explorer prints. " +
      "A correct txid sent forwards looks like a txid that does not exist.",
    fix:
      "Reverse the bytes: Buffer.from(hex, 'hex').reverse(). If the order is " +
      "already right, check you are querying the same network the txid is on.",
    sources: ["zcash/lightwallet-protocol v0.6.0, message TxFilter"],
  },
  {
    id: "dead-lightwalletd",
    match: /lightwalletd\.testnet\.electriccoin\.co|testnet\.lightwalletd\.com/i,
    cause: "That light-wallet server is retired and no longer answers.",
    fix: "Use testnet.zec.rocks:443.",
    sources: ["https://zechub.wiki/developers"],
  },
  {
    id: "grpc-unavailable",
    match: /UNAVAILABLE|14 UNAVAILABLE|DEADLINE_EXCEEDED|ETIMEDOUT|ECONNRESET/i,
    cause:
      "The light-wallet server or the network behind it did not answer in time. " +
      "Testnet has been unstable: Zebra 7.0.0 is unreleased, operators have " +
      "reported testnet nodes that stop syncing since 7.0.0-rc.0, and the " +
      "seeder's activation observer has reported fewer peer groups ready than " +
      "its quorum.",
    fix:
      "Retry with a longer deadline before changing your code. Capture any " +
      "on-chain evidence you need early rather than close to a deadline, and " +
      "check GetLightdInfo's estimatedHeight against blockHeight to see whether " +
      "the backend is still syncing.",
    sources: ["https://github.com/ZcashFoundation/zebra/issues/11674"],
    notYourFault: true,
  },
  {
    id: "npm-404-webzjs",
    // npm prints the registry URL percent-encoded, as @chainsafe%2fwebzjs-wallet.
    match: /(404|not found|E404).{0,60}@chainsafe(\/|%2f)webzjs|@chainsafe(\/|%2f)webzjs.{0,60}(not found|404)/i,
    cause:
      "@chainsafe/webzjs-wallet is not published on npm, and it has no Ironwood " +
      "support. Widely circulated guides still recommend it.",
    fix:
      "Do not build on it for NU7. Ask tool_status for a stack that works. " +
      "Building it from source needs Rust nightly, wasm-pack, just, yarn and a " +
      "gRPC-web proxy.",
    sources: ["npm view @chainsafe/webzjs-wallet (not published, checked 2026-11-04)"],
    notYourFault: true,
  },
  {
    id: "npm-404-zcash-sdk",
    // Matches both "@zcash/sdk" and the percent-encoded "@zcash%2fsdk" npm prints.
    match: /(404|not found|E404).{0,60}@zcash(\/|%2f)sdk|@zcash(\/|%2f)sdk.{0,60}(not found|404)/i,
    cause:
      "@zcash/sdk is not published on npm, despite being recommended for " +
      "payment links and QR codes.",
    fix:
      "ZIP 321 is a URI spec with no runtime dependency. Use payment_request " +
      "from this server, or implement the spec directly.",
    sources: ["npm view @zcash/sdk (not published, checked 2026-11-04)"],
    notYourFault: true,
  },
  {
    id: "orchard-only-address",
    match: /(orchard[- ]only|cannot receive|unable to receive).{0,40}(address|funds)|address.{0,30}cannot receive/i,
    cause:
      "The zecli build published on crates.io generates Orchard-only " +
      "addresses, which cannot receive funds.",
    fix:
      "Generate a unified address with at least one usable receiver. Build " +
      "zingolib from git rather than installing the published CLI, whose " +
      "version lags the library.",
    sources: ["https://crates.io/crates/zecli"],
    notYourFault: true,
  },
  {
    id: "v4-rejected",
    match: /version 4|v4 transaction|tx version.{0,10}4.{0,20}(invalid|not allowed|rejected)/i,
    cause: "NU7 disallows version 4 transactions (ZIP 2003).",
    fix:
      "Build v5 transactions (ZIP 225). If a library is emitting v4, it predates " +
      "NU7 and needs upgrading, not working around.",
    sources: ["https://zips.z.cash/zip-2003", "https://zips.z.cash/zip-0225"],
  },
  {
    id: "expired-transaction",
    match: /expir(ed|y).{0,40}(height|transaction|window)|transaction.{0,20}expired/i,
    cause:
      "From NU7 activation a transaction expires 120 blocks after its target " +
      "height, not 40. Code carrying the old constant computes the wrong window.",
    fix:
      "Let the SDK set the expiry height. If you must set it, use the NU7 value " +
      "and gate it on whether NU7 is active at that height.",
    sources: [
      "https://github.com/zcash/librustzcash/blob/main/zcash_client_backend/CHANGELOG.md (zcash_client_backend 0.25.0, 2026-10-21)",
    ],
  },
  {
    id: "orchard-output-rejected",
    match: /orchard.{0,30}(output|pool).{0,30}(reject|not allowed|disallow|seal)/i,
    cause:
      "Orchard is sealed. Since NU6.3 no transaction may create new Orchard " +
      "outputs; new shielded value goes to the Ironwood pool.",
    fix:
      "Target Ironwood for new value. To move existing Orchard funds, use the " +
      "ZIP 318 migration, which spends exactly one Orchard note and produces " +
      "exactly one Ironwood output.",
    sources: ["https://zips.z.cash/zip-2006", "https://zips.z.cash/zip-0318"],
  },
  {
    id: "invalid-unified-address",
    match: /(invalid|malformed|bad).{0,25}(unified )?address|bech32|checksum/i,
    cause:
      "Three causes, in order of how often they bite: the address was validated " +
      "by prefix instead of decoded, so a corrupted address passed; the address " +
      "is a Revision 2 form (zu, zutest, tu, tutest) that a u/utest check " +
      "rejects; or it carries MUST-understand metadata (typecodes 0xE0, 0xE1, " +
      "or 0xE2 through 0xFC) that your parser has to reject outright.",
    fix:
      "Decode rather than prefix-match: Bech32m, then F4Jumble inverse, then " +
      "parse typecodes. Reject MUST-understand items you do not implement " +
      "instead of ignoring them.",
    sources: ["https://zips.z.cash/zip-0316"],
  },
  {
    id: "memo-on-transparent",
    match: /memo.{0,30}(transparent|t-?addr)|transparent.{0,20}memo/i,
    cause:
      "A memo paired with a transparent address makes the whole ZIP 321 URI " +
      "invalid. A transparent output has nowhere to carry it.",
    fix: "Drop the memo, or pay a shielded receiver.",
    sources: ["https://zips.z.cash/zip-0321"],
  },
  {
    id: "memo-base64",
    match: /base64|memo.{0,20}(encoding|padding|invalid character)/i,
    cause:
      "ZIP 321 memos are base64url with no padding. The characters +, / and = " +
      "must be rejected, and the decoded memo may not exceed 512 bytes.",
    fix:
      "Encode with base64url and strip padding. In Node: " +
      "buf.toString('base64url').",
    sources: ["https://zips.z.cash/zip-0321"],
  },
  {
    id: "insufficient-testnet-funds",
    match: /insufficient (funds|balance)|not enough (funds|balance)/i,
    cause:
      "On testnet this is usually a faucet limit rather than a code problem. " +
      "Valar gives 0.125 TAZ per day per network and Fauzec 1 TAZ per day per " +
      "address.",
    fix:
      "Ask a mentor to send TAZ to your utest1 address, or wait out the faucet " +
      "window. Budget spend-recipes rather than running them on a schedule.",
    sources: ["https://faucet.testnet.valargroup.dev/", "https://fauzec.com/"],
    notYourFault: true,
  },
  {
    id: "zidecar",
    match: /zidecar/i,
    cause:
      "The git version of zcli needs a zidecar server, and none is hosted for " +
      "testnet.",
    fix: "Use a different stack. Ask tool_status.",
    sources: [],
    notYourFault: true,
  },
  {
    id: "wasm-pack-nightly",
    match: /wasm-pack|rust.{0,10}nightly|wasm32-unknown-unknown/i,
    cause:
      "This is the WebZjs build chain. It needs Rust nightly, wasm-pack, just " +
      "and yarn, and the result still has no Ironwood support.",
    fix:
      "Stop here unless you specifically need browser WASM. For a browser " +
      "wallet today, the Noir Wallet extension works and returns a txid.",
    sources: [],
    notYourFault: true,
  },
  {
    id: "noir-switch-network",
    match: /switchNetwork/i,
    cause:
      "Noir Wallet's switchNetwork() is deprecated and always throws. Mainnet " +
      "and testnet are separate extensions.",
    fix:
      "Install the testnet extension from the -testnet.zip asset of release " +
      "v1.0.39 or v1.0.40-beta, loaded unpacked. The v2.0.0-beta release ships " +
      "no testnet zip. The installed name should read [Testnet] Noir Wallet.",
    sources: ["https://github.com/NoirWallet/noir-wallet-sdk"],
  },
  {
    id: "noir-no-provider",
    match: /noirwallet|getNoirWallet.{0,20}null|provider.{0,20}(undefined|not found)/i,
    cause:
      "The SDK wraps the provider injected at window.noirwallet, so it is " +
      "browser-only and returns null during server-side rendering or when the " +
      "extension is absent.",
    fix:
      "Guard for null and call connect() from a user action such as a button " +
      "click. Use getAccounts() for a silent check during page initialisation.",
    sources: ["https://github.com/NoirWallet/noir-wallet-sdk"],
  },
];

export function explain(message: string): Explanation[] {
  const hits = ENTRIES.filter((e) => e.match.test(message)).map(
    ({ match, ...rest }) => rest,
  );
  return hits;
}

export const KNOWN_ERROR_IDS = ENTRIES.map((e) => e.id);
