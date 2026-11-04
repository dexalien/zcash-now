/**
 * Headless shielded sends through zcash-devtool.
 *
 * Noir Wallet asks a person to approve every spend, so the one recipe most
 * worth re-running could not run on a schedule. zcash-devtool is the CLI the
 * librustzcash maintainers use; built from git it is on the Ironwood and NU7
 * line, signs locally and needs no UI. Every subcommand and flag used here was
 * read from its source at the commit recorded in each receipt.
 *
 * The wallet sends to its own address, so a run costs the fee and nothing
 * else: the value comes straight back. That is what makes a spend recipe safe
 * to repeat on a budget instead of draining the faucet allowance.
 *
 * Configuration (all optional except the wallet):
 *   ZCASH_DEVTOOL_BIN      path to the built binary
 *   ZCASH_DEVTOOL_DIR      checkout, used for the binary and its commit
 *   ZCASH_NOW_WALLET_DIR   wallet created with `zcash-devtool wallet init`
 *   ZCASH_NOW_IDENTITY     age identity that decrypts the wallet's seed
 *   ZCASH_NOW_CONNECTION   "direct" (default), "tor", or "socks5://host:port"
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface DevtoolConfig {
  bin: string;
  dir?: string;
  wallet: string;
  identity: string;
  connection: string;
}

/** Null when this machine has no wallet: the spend recipe is then skipped. */
export function devtoolConfig(): DevtoolConfig | null {
  const dir = process.env.ZCASH_DEVTOOL_DIR ? resolve(process.env.ZCASH_DEVTOOL_DIR) : undefined;
  const bin =
    process.env.ZCASH_DEVTOOL_BIN ?? (dir ? join(dir, "target/release/zcash-devtool") : "");
  const wallet = process.env.ZCASH_NOW_WALLET_DIR ? resolve(process.env.ZCASH_NOW_WALLET_DIR) : "";
  const identity = process.env.ZCASH_NOW_IDENTITY
    ? resolve(process.env.ZCASH_NOW_IDENTITY)
    : join(wallet, "identity.txt");
  if (!bin || !existsSync(bin) || !wallet || !existsSync(wallet)) return null;
  return { bin, dir, wallet, identity, connection: process.env.ZCASH_NOW_CONNECTION ?? "direct" };
}

/** Carries the CLI's own output so isNetworkFailure can classify it. */
export class DevtoolError extends Error {}

function exec(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { env: { ...process.env, NO_COLOR: "1" } });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // Strip ANSI colour from tracing output before anyone parses it.
      const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
      if (code === 0) return ok(clean);
      const tail = clean.trim().split("\n").slice(-4).join(" | ");
      fail(
        new DevtoolError(
          `zcash-devtool ${args[2]} ${signal === "SIGKILL" ? "timed out (DEADLINE_EXCEEDED)" : `exited ${code}`}: ${tail}`,
        ),
      );
    });
  });
}

const wallet = (c: DevtoolConfig, sub: string, args: string[] = [], timeoutMs = 10 * 60_000) =>
  exec(c.bin, ["wallet", "-w", c.wallet, sub, ...args], timeoutMs);

// `-s zecrocks` resolves to testnet.zec.rocks:443 for a testnet wallet.
const server = (c: DevtoolConfig) => ["-s", "zecrocks", "--connection", c.connection];

export async function devtoolCommit(c: DevtoolConfig): Promise<string> {
  if (!c.dir) return "unknown";
  try {
    return (await exec("git", ["-C", c.dir, "rev-parse", "--short", "HEAD"], 10_000)).trim();
  } catch {
    return "unknown";
  }
}

export async function sync(c: DevtoolConfig): Promise<void> {
  await wallet(c, "sync", server(c), 20 * 60_000);
}

export async function ownAddress(c: DevtoolConfig): Promise<string> {
  const out = await wallet(c, "list-addresses");
  const ua = out.match(/Default Address:\s*(utest1[0-9a-z]+)/)?.[1];
  if (!ua) throw new Error("list-addresses printed no utest1 default address");
  return ua;
}

/** Broadcasts and returns the txid, which `send` prints as its last line. */
export async function send(
  c: DevtoolConfig,
  p: { address: string; zats: number; memo: string },
): Promise<string> {
  const out = await wallet(c, "send", [
    "-i", c.identity,
    "--address", p.address,
    "--value", String(p.zats),
    "--memo", p.memo,
    ...server(c),
  ]);
  const txid = [...out.matchAll(/^([0-9a-f]{64})$/gm)].pop()?.[1];
  if (!txid) throw new Error(`send finished without printing a txid: ${out.trim().split("\n").slice(-3).join(" | ")}`);
  return txid;
}

/**
 * Finds a transaction in `list-tx` text output and returns where it was mined
 * and whether our memo decrypted. CSV mode is no use here: it omits
 * wallet-internal transfers, which is exactly what a send-to-self is.
 */
export async function findInHistory(
  c: DevtoolConfig,
  txid: string,
  memo: string,
): Promise<{ minedHeight: number | null; memoFound: boolean } | null> {
  const out = await wallet(c, "list-tx");
  const start = out.indexOf(txid);
  if (start < 0) return null;
  const next = out.slice(start + txid.length).search(/^[0-9a-f]{64}$/m);
  const block = out.slice(start, next < 0 ? undefined : start + txid.length + next);
  const mined = block.match(/Mined:\s*(\d+)/);
  return { minedHeight: mined ? Number(mined[1]) : null, memoFound: block.includes(memo) };
}
