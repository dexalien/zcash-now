# Status

Every row was produced by running the recipe, not by asserting it works.
A grey row says what is missing instead of claiming a pass.

- Checked against: `testnet.zec.rocks:443`
- Chain height at the time: 4582077
- Generated: 2026-11-04T12:41:28.614Z

| | Recipe | Cost | Proof | Detail |
|---|---|---|---|---|
| green | `chain-status` | read | block 4582077 | tip 4582077, branch 77190ad9, NU7 active above 4465026, server ECC LightWalletD v0.6.1 |
| green | `standard-fee` | read | block 4582077 | 1000 zatoshi per logical action, estimatorVersion 0 (static ZIP 317 marginal fee) |
| green | `payment-request` | pure | block 4582077 | round-tripped and rejected 6 invalid URIs |
| green | `fact-base-drift` | read | block 4582077 | 18 asserted ZIP statuses all match the published index (87 rows read) |
| green | `decode-address` | pure | block 4582077 | round-tripped a utest unified address through Bech32m and F4Jumble, recovered typecode 0x3, and rejected 3 addresses a prefix check would accept |
| grey | `verify-txid` | read | block 4582077 | No sealed txid yet. Set ZCASH_NOW_SEALED_TXID to the txid of a shielded payment approved in a wallet. This recipe is human-gated: Noir Wallet requires approval, so it cannot run on a schedule. |
| grey | `shielded-send` | human | block 4582077 | No sealed txid yet. Set ZCASH_NOW_SEALED_TXID to the txid of a shielded payment approved in a wallet. This recipe is human-gated: Noir Wallet requires approval, so it cannot run on a schedule. |

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
