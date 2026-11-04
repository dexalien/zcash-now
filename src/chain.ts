/**
 * Live chain access over gRPC.
 *
 * The point of this module is that a fact asked of the chain cannot go
 * stale. Anything that can be read from a light-wallet server is read
 * here rather than stated in facts.ts.
 *
 * Service: CompactTxStreamer, package cash.z.wallet.sdk.rpc
 * Definition: zcash/lightwallet-protocol v0.6.0
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ENDPOINTS, UPGRADES } from "./facts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = join(HERE, "..", "proto");

export interface LightdInfo {
  version: string;
  vendor: string;
  taddrSupport: boolean;
  chainName: string;
  saplingActivationHeight: string;
  consensusBranchId: string;
  blockHeight: string;
  gitCommit: string;
  branch: string;
  buildDate: string;
  estimatedHeight: string;
}

export interface StandardFee {
  feeZat: string;
  estimatorVersion: number;
}

let cached: grpc.Client | null = null;

function client(endpoint = ENDPOINTS.testnet): any {
  if (cached) return cached;
  const def = protoLoader.loadSync(join(PROTO_DIR, "service.proto"), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR],
  });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const Ctor = pkg.cash.z.wallet.sdk.rpc.CompactTxStreamer;
  cached = new Ctor(endpoint, grpc.credentials.createSsl());
  return cached;
}

function call<T>(method: string, arg: unknown, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);
    (client() as any)[method](arg, { deadline }, (err: Error | null, res: T) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

export const getLightdInfo = () => call<LightdInfo>("GetLightdInfo", {});
export const getLatestBlock = () =>
  call<{ height: string; hash: Buffer }>("GetLatestBlock", {});

/**
 * Ask the server for the current standard fee per logical action.
 *
 * Not every backend implements the underlying getstandardfee RPC; those
 * return UNIMPLEMENTED, which is a legitimate answer and not a failure of
 * the caller. estimatorVersion 0 means the static ZIP 317 marginal fee.
 */
export async function getStandardFee(): Promise<
  { available: true; fee: StandardFee } | { available: false; reason: string }
> {
  try {
    const fee = await call<StandardFee>("GetStandardFee", {});
    return { available: true, fee };
  } catch (e: any) {
    if (e?.code === grpc.status.UNIMPLEMENTED)
      return {
        available: false,
        reason:
          "This server does not implement getstandardfee. Let your SDK compute " +
          "the ZIP 317 fee instead of hardcoding one.",
      };
    return { available: false, reason: String(e?.message ?? e) };
  }
}

/**
 * A txid as printed by an explorer is in reverse byte order relative to the
 * internal representation that TxFilter.hash expects. Getting this backwards
 * is the single most common reason a correct txid "is not found".
 */
export function txidHexToBytes(hex: string): Buffer {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean))
    throw new Error(
      `Not a txid: expected 64 hex characters, got ${clean.length}.`,
    );
  return Buffer.from(clean, "hex").reverse();
}

export async function getTransaction(txidHex: string) {
  return call<{ data: Buffer; height: string }>("GetTransaction", {
    hash: txidHexToBytes(txidHex),
    block: null,
    index: 0,
  });
}

/**
 * How far blockHeight may sit from estimatedHeight before the backend is
 * really behind. NU7 targets 25-second blocks (ZIP 218), so the two values
 * are routinely a block apart simply because a block arrived between them.
 * Treating that as "still syncing" reports a healthy server as broken.
 */
export const SYNC_TOLERANCE_BLOCKS = 3;

export interface ChainStatus {
  endpoint: string;
  chainName: string;
  /** "test" or "main", as the server reports it. */
  network: string;
  height: number;
  estimatedHeight: number;
  /** estimatedHeight - height. Negative means the tip is ahead of the estimate. */
  heightGap: number;
  synced: boolean;
  consensusBranchId: string;
  serverVersion: string;
  serverVendor: string;
  nu7: {
    activationHeight: number | null;
    active: boolean | null;
    blocksUntilActivation: number | null;
    note: string;
  };
  askedAt: string;
}

/**
 * What chain is this, how far along is it, and is NU7 actually active here.
 *
 * The activation heights come from facts.ts, but whether NU7 is active is
 * computed against the height the server reports right now.
 */
export async function chainStatus(): Promise<ChainStatus> {
  const info = await getLightdInfo();
  const height = Number(info.blockHeight);
  const estimated = Number(info.estimatedHeight);
  const gap = estimated === 0 ? 0 : estimated - height;
  const isTest = info.chainName === "test";

  const activation = isTest
    ? UPGRADES.nu7.testnetActivationHeight
    : UPGRADES.nu7.mainnetActivationHeight;

  const active = height >= activation;

  return {
    endpoint: ENDPOINTS.testnet,
    chainName: info.chainName,
    network: isTest ? "test" : "main",
    height,
    estimatedHeight: estimated,
    heightGap: gap,
    // A gap within tolerance is a block arriving mid-call, not a backend
    // that is behind. See SYNC_TOLERANCE_BLOCKS.
    synced: estimated === 0 || gap <= SYNC_TOLERANCE_BLOCKS,
    consensusBranchId: info.consensusBranchId,
    serverVersion: info.version,
    serverVendor: info.vendor,
    nu7: {
      activationHeight: activation,
      active,
      blocksUntilActivation: active ? 0 : activation - height,
      note: active
        ? `NU7 is active here: tip ${height} is at or above activation ${activation}. ` +
          `Version 4 transactions are disallowed (ZIP 2003) and a transaction ` +
          `expires 120 blocks after its target height, not 40.`
        : `NU7 is NOT yet active on this chain: tip ${height} is below ` +
          `activation ${activation}.`,
    },
    askedAt: new Date().toISOString(),
  };
}

export function closeChain(): void {
  if (cached) {
    (cached as any).close?.();
    cached = null;
  }
}
