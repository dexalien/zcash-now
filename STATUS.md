# Status

Every green row was produced by running the recipe on this run, not by
asserting it works. A grey row says what is missing instead of claiming a
pass. A carried row was produced by an earlier run and is reproduced here with
the time it actually happened, because a spend cannot run where there is no
wallet.

- Checked against: `testnet.zec.rocks:443`
- Chain height at the time: 4607199
- Generated: 2026-11-11T06:12:53.806Z

| | Recipe | Cost | Proof | Detail |
|---|---|---|---|---|
| green | `chain-status` | read | block 4607199 | tip 4607199, branch 77190ad9, NU7 active above 4465026, server ECC LightWalletD v0.6.1 |
| green | `standard-fee` | read | block 4607199 | server does not serve a fee: This server does not implement getstandardfee. Let your SDK compute the ZIP 317 fee instead of hardcoding one. |
| green | `payment-request` | pure | block 4607199 | round-tripped and rejected 6 invalid URIs |
| RED | `fact-base-drift` | read | block 4607199 | 2 ZIP(s) drifted from the published index. ZIP 2005 (Ironwood Quantum Recoverability): we say "Proposed", the index says "Final". The fact base is out of date. \| ZIP 229 (Version 6 Transaction Format): we say "Draft", the index says "Final". The fact base is out of date. |
| green | `decode-address` | pure | block 4607199 | round-tripped a utest unified address through Bech32m and F4Jumble, recovered typecode 0x3, and rejected 3 addresses a prefix check would accept |
| carried | `headless-send` | spend | `13fefa00dd7b28a221430450b683be28e03a8a9d5b3bc6296252c0de20463908` | carried from the run at 2026-11-04T12:47:20.519Z. sent 10000 zat to its own unified address with memo "zcash-now 2026-11-04T12:47:20.519Z" |
| carried | `read-memo` | read | `13fefa00dd7b28a221430450b683be28e03a8a9d5b3bc6296252c0de20463908` | carried from the run at 2026-11-04T12:47:25.323Z. memo decrypted locally from the tx mined at 4582095, outputs in Ironwood, after 3 sync(s) |
| green | `verify-txid` | read | `13fefa00dd7b28a221430450b683be28e03a8a9d5b3bc6296252c0de20463908` | txid mined at height 4582095, 9166 bytes |
| grey | `shielded-send` | human | block 4607199 | No sealed txid yet. Set ZCASH_NOW_SEALED_TXID to the txid of a shielded payment approved in a wallet. This recipe is human-gated: Noir Wallet requires approval, so it cannot run on a schedule. |

**amber is not red.** A network row means the light-wallet server or the path
to it did not answer, which says nothing about whether the recipe works. Only a
red row fails the run. Testnet has been unstable, so collapsing the two would
make this board cry wolf, and a board that cries wolf is worse than none.

## What each recipe gives away

Stated per recipe, because a privacy note at the bottom of a README is easy to
write and easy to ignore, and this travels with the code.

- **`chain-status`** — The light-wallet server learns your IP address and that you asked for chain state. Nothing about any wallet or address is sent.
- **`standard-fee`** — The light-wallet server learns your IP address. The query carries no address, amount or transaction.
- **`payment-request`** — Nothing over the network: this runs offline. But the URI itself is the leak surface. Anyone you hand it to sees the address, the amount and the memo, and a memo is readable by every holder of the viewing key, so put an opaque order id there and not a customer's name.
- **`fact-base-drift`** — zips.z.cash learns the runner's IP address and that it fetched the public index. No address, key or transaction is involved.
- **`decode-address`** — Nothing. This is offline arithmetic on the address itself; no server is contacted and the address never leaves the process.
- **`verify-txid`** — The light-wallet server learns your IP address and exactly which transaction you care about. That is a real disclosure, and it is why this goes to a light-wallet server over TLS instead of to a third-party explorer: one party instead of two. Routing it through Nym would remove the IP, and has not been done yet.
- **`shielded-send`** — On chain: nothing about amount, sender or receiver, which is the point of a shielded payment. Off chain: the wallet's own light-wallet server sees your IP and the moment you broadcast, which is a timing signal. The memo is readable by every holder of the viewing key. And once the txid is published as a receipt here, this particular payment is publicly linked to this project, which is a disclosure we chose to make and would not make with a real user's payment.
- **`headless-send`** — On chain: nothing about amount, sender or receiver; the memo is encrypted. Off chain: testnet.zec.rocks sees the runner's IP and the moment it broadcasts, unless ZCASH_NOW_CONNECTION=tor routes it over Tor. The runner holds a testnet seed, which is a trust cost we accept for testnet only. Publishing the txid links this payment to this project, by choice.
- **`read-memo`** — The light-wallet server sees the runner's IP and when it syncs. It serves the same compact blocks to everyone, so it does not learn which transactions are ours. The memo never leaves the machine.

## Reading this

`cost` is what it takes to run the recipe, and it decides how often it runs:

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
