# zcash-now

**Zcash documentation that cannot lie.** Every recipe in this repository is run
against NU7 testnet and stamped with the block height, the tool versions and
the txid it produced. A recipe with no receipt says so instead of claiming to
work.

It ships as an MCP server, so an AI coding agent can ask what is true right now
rather than repeating what was true before NU6.3.

Current receipts: [STATUS.md](./STATUS.md) · raw: [receipts.json](./receipts.json)

## The problem

Zcash's correctness rules changed under NU6.3 (Ironwood, mainnet block
3,428,143, 2026-07-28) and NU7 (testnet block 4,465,026). The changes are
subtle, some of them cost funds, and they are absent from the material that
coding agents have read. So agents confidently emit code that targets a sealed
pool, hardcodes a fee that is now wrong, and points at light-wallet servers
that were retired.

Four examples this server encodes, each traceable to its source:

| What agents write | What is true now |
|---|---|
| Looks for an "Ironwood receiver" to check an address | There is no Ironwood receiver, format or encoding. Typecode `0x03` is still named Orchard, and it is how Ironwood funds are received ([ZIP 326](https://zips.z.cash/zip-0326)) |
| Sends to an Orchard receiver after activation | Never send to an external Orchard-*pool* receiver; pay Orchard-*protocol* receivers into Ironwood. ZIP 326 lists getting this wrong as potential loss of funds **and** a privacy leak |
| `expiry_height = target + 40` | 120 blocks from NU7 activation (`zcash_client_backend` 0.25.0, 2026-10-21) |
| `addr.startsWith("utest1")` | Six prefixes across revisions: `u`/`utest`, `zu`/`zutest`, `tu`/`tutest` ([ZIP 316](https://zips.z.cash/zip-0316)) |

The same decay hits documents, not just models. Developer material written
before 2026-10-20 says NU7 mainnet activation is unscheduled. The height was
decided that day: block 3,543,405 ([zcash/zips#1405](https://github.com/zcash/zips/pull/1405)).

## How it avoids becoming part of the problem

Three rules, in order of precedence:

1. **If the chain can answer it, ask the chain.** Network, tip height,
   consensus branch id, sync state and the standard fee are read over gRPC from
   a light-wallet server. These cannot go stale because they are not stored.
2. **If it must be stated, state its source.** Every entry in
   [`src/facts.ts`](./src/facts.ts) carries the ZIP or changelog it came from,
   *that source's own status*, and the date it was checked. Status matters: ZIP
   254 is Withdrawn in favour of 259, and ZIP 2009 is Proposed and
   non-consensus, so citing either as a current NU7 rule is wrong.
3. **If it is a recipe, run it.** The runner executes each recipe and records
   what happened. Nothing is described as working on the strength of having
   been written down.

A worked example of why rule 1 beats rule 2: the live server currently reports
a standard fee of **1000 zatoshi per logical action** with `estimatorVersion: 0`,
which the protocol defines as the static ZIP 317 marginal fee. ZIP 2009, which
proposes exactly that reduction, is still listed as *Proposed*. We do not
resolve which source is ahead of the other, because asking the server is
correct either way, and a hardcoded 5000 would have been wrong today.

## Tools

Fourteen, over stdio.

| Tool | What it does |
|---|---|
| `chain_status` | Network, tip, consensus branch and whether NU7 is active **at that height** |
| `standard_fee` | The current fee from the server. `UNIMPLEMENTED` is a valid answer |
| `verify_transaction` | Confirms a txid on chain, handling the byte-order reversal |
| `zcash_rules` | The NU6.3/NU7 rules agents get wrong, filterable by whether they cost funds or leak privacy |
| `zcash_zips` | The ZIPs that matter, each with its own current status |
| `typecodes` | The ZIP 316 registry, and what a parser must do with each range |
| `recipe_that_works` | Working code for a task, plus the receipt from its last run |
| `tool_status` | Whether a package works today, and why |
| `explain_error` | Maps an error message onto its cause |
| `lint_zcash_code` | Finds code that was correct before NU6.3/NU7 |
| `privacy_lint` | Finds code that leaks even though it works, and says what becomes visible to whom |
| `decode_address` | Decodes a unified address for real: Bech32m, F4Jumble inverse, ZIP 316 typecodes |
| `payment_request` | Builds a ZIP 321 URI, refusing to emit an invalid one |
| `parse_payment_request` | Validates a ZIP 321 URI against all thirteen rules |

Two lints, because they answer different questions. `lint_zcash_code` asks
whether the code is still correct. `privacy_lint` asks what it gives away while
being correct: a transparent recipient works perfectly and publishes the
payment; a memo works perfectly and carries an email address to everyone
holding the viewing key.

### Install

```bash
npm install && npx tsc
```

Then point an MCP client at it:

```json
{
  "mcpServers": {
    "zcash-now": { "command": "node", "args": ["/path/to/zcash-now/dist/index.js"] }
  }
}
```

Run the recipes yourself:

```bash
node dist/runner.js        # writes receipts.json and STATUS.md
```

## Recipes are split by what they cost

This is a correctness decision, not an implementation detail. A status board
that goes red for the wrong reason is worse than no status board.

- **read** — free. Runs on every scheduled run.
- **pure** — no network at all.
- **spend** — consumes testnet funds. Budgeted, never scheduled: the faucets
  give 0.125 TAZ/day (Valar) and 1 TAZ/day (Fauzec), so a timer would drain the
  wallet and then report failure for lack of funds rather than for a real
  regression.
- **human** — needs a person to approve in a wallet UI, so it cannot be
  scheduled at all. Its receipt is sealed from a run someone actually approved,
  then re-verified on chain independently.

Scheduled runs are also not punctual, because GitHub Actions delays and skips
cron under load. So a receipt carries the block height it ran at rather than a
promise about frequency.

## Technologies used

| Piece | Why |
|---|---|
| TypeScript, Node ≥20 | The MCP SDK and the Noir Wallet SDK are both TS |
| `@modelcontextprotocol/sdk` 1.32.2 | MCP server over stdio |
| `@grpc/grpc-js` 1.14.7, `@grpc/proto-loader` 0.8.1 | Light-wallet server client |
| `zcash/lightwallet-protocol` v0.6.0 | `CompactTxStreamer` service definition, vendored in [`proto/`](./proto) |
| `zod` 4.6.7 | Tool input schemas |
| `@noir-wallet/sdk` 0.1.9 | The shielded send, which returns a txid |
| `testnet.zec.rocks:443` | The light-wallet server. The older testnet endpoints are retired |

ZIP 321 is implemented directly rather than through `@zcash/sdk`, which is
widely recommended but **is not published on npm**. It is a URI spec with no
runtime dependency, so the dependency was not worth a broken install.

## Design decisions

- **No keys, ever.** This server holds no spending key, no viewing key and no
  seed, and has no code path that could. Everything it does is read-only or
  pure. The one operation that moves funds is delegated to a wallet the user
  controls, which asks them to approve it.
- **gRPC, not an explorer API.** Verification goes straight to a light-wallet
  server rather than scraping an explorer. This is partly reliability — the
  testnet explorers return 403 on their `/api/*` paths — and partly privacy: we
  do not hand a third party a list of which transactions we care about.
- **Prefix checks are treated as bugs.** `lint_zcash_code` flags
  `startsWith("utest1")`, because it accepts a corrupted address that fails its
  Bech32m checksum and rejects valid Revision 2 forms.
- **Source status is carried, not flattened.** A Draft ZIP and a Final ZIP are
  not the same claim, and collapsing them is how stale advice spreads.
- **Known-bad is first-class.** `tool_status` names what is broken and why.
  Several broken packages are still widely recommended, and that is where the
  hours go.

## Privacy and trust note

**What stays private.** Nothing about a user passes through this server: it
never sees an address, a payment, a key or a balance except as an argument a
developer chose to pass it, and it stores none of them. The shielded payments
in the recipes are shielded on-chain in the ordinary way — amounts, sender and
receiver are not public.

**What it reveals, and to whom.**

- The **light-wallet server** (`testnet.zec.rocks:443`) sees our IP address and
  every query we make, including which txids we look up. Over time that is a
  behavioural profile, and it is unmitigated today.
- The **AI model provider** behind whichever agent calls this server sees the
  prompts and tool results, which may include addresses and txids a developer
  pasted in.
- **GitHub** sees the scheduled runner's logs, and the public repository
  publishes every receipt, including the sealed txid.
- **The faucets and the Noir Wallet extension** see what they normally see when
  funding and sending.

**What users must trust.** The light-wallet server, to answer honestly about
chain state — we take its word on height and branch id. The published ZIPs and
changelogs, which this server cites rather than independently verifying. The
Noir Wallet extension, for the one operation that spends. The maintainers of
this repository, for what goes into the fact base. GitHub, for the runner. And
their own model provider.

**What we would fix next.**

- **Network privacy is missing.** The light-wallet server sees our IP and sync
  pattern. `zingolib` ships `zingo-nym-proxy-ffi`, so routing the gRPC client
  through Nym is a concrete next step rather than an aspiration.
- **The spend recipe is human-gated.** Noir Wallet requires approval, so the
  one recipe that moves funds cannot be re-run on a schedule, which is exactly
  the recipe most worth re-running. Headless sending via `zingolib` built from
  git — it pins `zcash_client_backend` `=0.25.0`, the Ironwood and NU7 line —
  would close this, and the wallet seed would then be a secret we hold, which
  is a trust cost worth stating in advance.
- **`parse_payment_request` does not yet call the decoder.** `decode_address`
  decodes unified addresses fully and is verified against the official vectors,
  but the ZIP 321 parser still checks only the address family and network, so a
  URI carrying an expired address passes the URI check. Wiring one to the other
  is small and is the next commit.
- **Amount privacy is not addressed.** A distinctive amount can identify a
  payment even when sender and receiver are shielded, and neither lint looks at
  amounts.
- **The fact base is a single maintainer's reading.** Nothing cross-checks it
  against the ZIPs automatically. A linter over the fact base against
  `zips.z.cash` would make rule 2 as self-correcting as rule 1 already is.

Self-custody alone is not a privacy design, and neither is being read-only.
This server's privacy argument is narrower and, we think, more honest: **code
that is wrong about NU6.3 leaks privacy**, so a tool that keeps other people's
code correct is doing privacy work even though it never touches a key.

## Next step, in the 30 days after

1. Publish to npm and serve `llms.txt` at a stable URL, so an agent can pick up
   the rules without installing anything.
2. Route the gRPC client through Nym, using `zingo-nym-proxy-ffi`.
3. Replace the human-gated spend with a headless one built on `zingolib`, so
   the full loop re-runs on a schedule.
4. Offer the tool-status table to the [ZecHub developer hub](https://zechub.wiki/developers),
   which is the curated map most people start from and the place a stale "use
   Orchard" pointer does the most damage.
5. NU7 activates on mainnet around 2026-11-06, two days after this was written.
   Mainnet recipes and receipts follow, which is the real test of whether the
   design holds.

## Status of this work

Built in one day. The honest shape of it:

- The read and pure recipes pass against live testnet and are reproducible by
  anyone who clones this.
- F4Jumble and unified address decoding are verified against the official
  vectors in [zcash/zcash-test-vectors](https://github.com/zcash/zcash-test-vectors):
  8/8 forward and inverse, length limits rejected, and all 60 unified-address
  vectors decoded with every receiver recovered exactly. Run it yourself with
  `node test/f4jumble.test.mjs` and `node test/address.test.mjs`.
- The shielded send works and is the source of the sealed txid, but it needs a
  person to approve it, so it is not part of the scheduled run.
- Both lints are pattern matching. They find the known cases and say so; they
  are not a review.

## Licence

MIT.
