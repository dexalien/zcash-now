# Status

Every row was produced by running the recipe, not by asserting it works.
A grey row says what is missing instead of claiming a pass.

- Checked against: `testnet.zec.rocks:443`
- Chain height at the time: 4581911
- Generated: 2026-11-04T11:31:29.731Z

| | Recipe | Cost | Proof | Detail |
|---|---|---|---|---|
| green | `chain-status` | read | block 4581911 | tip 4581911, branch 77190ad9, NU7 active above 4465026, server ECC LightWalletD v0.6.1 |
| green | `standard-fee` | read | block 4581911 | 1000 zatoshi per logical action, estimatorVersion 0 (static ZIP 317 marginal fee) |
| green | `payment-request` | pure | block 4581911 | round-tripped and rejected 5 invalid URIs |
| grey | `verify-txid` | read | block 4581911 | No sealed txid yet. Set ZCASH_NOW_SEALED_TXID to the txid of a shielded payment approved in a wallet. This recipe is human-gated: Noir Wallet requires approval, so it cannot run on a schedule. |
| grey | `shielded-send` | human | block 4581911 | No sealed txid yet. Set ZCASH_NOW_SEALED_TXID to the txid of a shielded payment approved in a wallet. This recipe is human-gated: Noir Wallet requires approval, so it cannot run on a schedule. |

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
