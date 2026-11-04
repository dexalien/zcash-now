/**
 * ZIP 321 payment request URIs, built and parsed against the spec.
 *
 * ZIP 321 is Active and has thirteen validation rules a parser must enforce.
 * An implementation written from memory typically gets three of them, which
 * is why this exists rather than a hand-rolled template string.
 *
 * Spec: https://zips.z.cash/zip-0321
 */

import { decodeUnifiedAddress } from "./address.js";

export interface Payment {
  /** Index as it appears in the URI. The empty index is 0 here. */
  index: number;
  address: string;
  /** Decimal ZEC, as written. Never converted to a float. */
  amount?: string;
  /** Decoded memo bytes, if present. */
  memo?: Buffer;
  label?: string;
  message?: string;
  /** Raw base64url of req-asset, if present. */
  reqAsset?: string;
}

export interface ParseResult {
  ok: boolean;
  payments: Payment[];
  errors: string[];
}

export interface Zip321Options {
  network?: "main" | "test";
  /**
   * Fully decode unified addresses rather than only checking their family.
   * On by default: a URI whose address fails its Bech32m checksum, or which
   * carries metadata ZIP 316 forbids ignoring, is not a usable payment
   * request, and saying otherwise is the bug this project is about.
   */
  deep?: boolean;
  /** Current chain height, so an address carrying an expiry can be judged. */
  height?: number;
  /** Current unix time in seconds, for a time-based expiry. */
  now?: number;
}

const MAX_ZEC = 21_000_000n;
const MAX_MEMO_BYTES = 512;

// ---------------------------------------------------------------------------
// base64url, without padding (ZIP 321 rejects +, / and =)
// ---------------------------------------------------------------------------

export function encodeMemo(memo: string | Buffer): string {
  const buf = Buffer.isBuffer(memo) ? memo : Buffer.from(memo, "utf8");
  if (buf.length > MAX_MEMO_BYTES)
    throw new Error(
      `Memo is ${buf.length} bytes; ZIP 321 allows at most ${MAX_MEMO_BYTES}.`,
    );
  return buf.toString("base64url");
}

function decodeMemo(value: string): Buffer {
  if (/[+/=]/.test(value))
    throw new Error(
      "Memo must be base64url with no padding: the characters +, / and = are " +
        "rejected (ZIP 321).",
    );
  if (!/^[A-Za-z0-9_-]*$/.test(value))
    throw new Error("Memo is not valid base64url.");
  const buf = Buffer.from(value, "base64url");
  if (buf.length > MAX_MEMO_BYTES)
    throw new Error(
      `Memo decodes to ${buf.length} bytes; the limit is ${MAX_MEMO_BYTES}.`,
    );
  return buf;
}

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

/** amountparam = "amount" [ paramindex ] "=" 1*DIGIT [ "." 1*8DIGIT ] */
export function validateAmount(raw: string): string[] {
  const errors: string[] = [];
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) {
    if (/,/.test(raw)) errors.push(`Amount "${raw}": the separator must be a period, not a comma.`);
    else if (/^\./.test(raw) || /\.$/.test(raw))
      errors.push(`Amount "${raw}": the whole part and the fraction must both be non-empty.`);
    else if (/\.\d{9,}/.test(raw))
      errors.push(`Amount "${raw}": at most 8 fractional digits are allowed.`);
    else errors.push(`Amount "${raw}" does not match the ZIP 321 grammar.`);
    return errors;
  }
  const whole = BigInt(raw.split(".")[0]);
  if (whole > MAX_ZEC || (whole === MAX_ZEC && /\.[1-9]/.test(raw)))
    errors.push(`Amount "${raw}" exceeds the maximum of ${MAX_ZEC} ZEC.`);
  return errors;
}

// ---------------------------------------------------------------------------
// Address shape. Full decoding lives in address.ts; here we only enforce the
// ZIP 321 rules that do not require un-jumbling a unified address.
// ---------------------------------------------------------------------------

export type AddressKind = "transparent" | "sapling" | "unified" | "sprout" | "unknown";

const UA_HRPS = ["u", "utest", "zu", "zutest", "tu", "tutest"];

export function addressKind(addr: string): { kind: AddressKind; network?: "main" | "test" } {
  const a = addr.trim();
  if (/^zc[a-km-zA-HJ-NP-Z1-9]{93}$/.test(a)) return { kind: "sprout", network: "main" };
  if (/^ztestsapling1[0-9a-z]+$/.test(a)) return { kind: "sapling", network: "test" };
  if (/^zs1[0-9a-z]+$/.test(a)) return { kind: "sapling", network: "main" };
  if (/^(t1|t3)[a-km-zA-HJ-NP-Z1-9]{33}$/.test(a)) return { kind: "transparent", network: "main" };
  if (/^(tm|t2)[a-km-zA-HJ-NP-Z1-9]{33}$/.test(a)) return { kind: "transparent", network: "test" };

  const sep = a.lastIndexOf("1");
  if (sep > 0) {
    const hrp = a.slice(0, sep).toLowerCase();
    if (UA_HRPS.includes(hrp))
      return { kind: "unified", network: hrp.includes("test") ? "test" : "main" };
  }
  return { kind: "unknown" };
}

const isShielded = (k: AddressKind) => k === "sapling" || k === "unified";

/**
 * Checks a unified address properly. Returns the reasons it is unusable, or an
 * empty list. Only unified addresses can be decoded this way; the other
 * families keep their shape checks above.
 */
function deepAddressErrors(
  address: string,
  kind: AddressKind,
  opts: Zip321Options,
): string[] {
  if (kind !== "unified" || opts.deep === false) return [];
  const d = decodeUnifiedAddress(address, {
    network: opts.network,
    height: opts.height,
    now: opts.now,
  });
  return d.valid ? [] : d.errors;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuildPayment {
  address: string;
  amount?: string;
  memo?: string | Buffer;
  label?: string;
  message?: string;
}

/**
 * Build a ZIP 321 URI. Throws rather than emitting something a conforming
 * parser would reject.
 */
export function build(payments: BuildPayment[], opts: Zip321Options = {}): string {
  if (payments.length === 0) throw new Error("At least one payment is required.");

  const parts: string[] = [];

  payments.forEach((p, i) => {
    // Index 0 uses the empty index; the rest start at 1 (paramindex is NONZERO).
    const ix = i === 0 ? "" : `.${i}`;
    const { kind, network } = addressKind(p.address);

    if (kind === "sprout")
      throw new Error("Sprout addresses are not allowed in a ZIP 321 URI.");
    if (kind === "unknown")
      throw new Error(`Address ${i} is not a recognised Zcash address: ${p.address}`);
    if (opts.network && network && network !== opts.network)
      throw new Error(
        `Address ${i} is a ${network}net address but the request targets ${opts.network}net.`,
      );
    if (p.memo !== undefined && !isShielded(kind))
      throw new Error(
        `Payment ${i} puts a memo on a ${kind} address, which makes the whole ` +
          "URI invalid (ZIP 321).",
      );

    if (p.amount !== undefined) {
      const errs = validateAmount(p.amount);
      if (errs.length) throw new Error(errs.join(" "));
    }

    const deep = deepAddressErrors(p.address, kind, opts);
    if (deep.length)
      throw new Error(`Address ${i} does not decode: ${deep.join(" ")}`);

    parts.push(`address${ix}=${p.address}`);
    if (p.amount !== undefined) parts.push(`amount${ix}=${p.amount}`);
    if (p.memo !== undefined) parts.push(`memo${ix}=${encodeMemo(p.memo)}`);
    // Only label, message and other qchar values may be percent-encoded.
    if (p.label !== undefined) parts.push(`label${ix}=${encodeURIComponent(p.label)}`);
    if (p.message !== undefined) parts.push(`message${ix}=${encodeURIComponent(p.message)}`);
  });

  return `zcash:?${parts.join("&")}`;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export function parse(uri: string, opts: Zip321Options = {}): ParseResult {
  const errors: string[] = [];
  const raw = uri.trim();

  if (!raw.toLowerCase().startsWith("zcash:"))
    return { ok: false, payments: [], errors: ['URI must start with "zcash:".'] };
  if (raw.includes("//"))
    errors.push('URI must not contain "//" (ZIP 321).');

  const rest = raw.slice("zcash:".length);
  const qIndex = rest.indexOf("?");
  const pathAddress = qIndex === -1 ? rest : rest.slice(0, qIndex);
  const query = qIndex === -1 ? "" : rest.slice(qIndex + 1);

  // Buckets keyed by index; the path address is treated as address with the
  // empty index.
  const byIndex = new Map<number, Record<string, string>>();
  const seen = new Set<string>();

  const put = (name: string, index: number, value: string) => {
    const key = `${name}.${index}`;
    if (seen.has(key)) {
      errors.push(`Duplicate parameter "${name}" at index ${index || "(empty)"}.`);
      return;
    }
    seen.add(key);
    const bucket = byIndex.get(index) ?? {};
    bucket[name] = value;
    byIndex.set(index, bucket);
  };

  if (pathAddress) put("address", 0, decodeURIComponent(pathAddress));

  if (query) {
    for (const pair of query.split("&")) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      const rawName = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? "" : pair.slice(eq + 1);

      const dot = rawName.indexOf(".");
      const name = dot === -1 ? rawName : rawName.slice(0, dot);
      const ixStr = dot === -1 ? "" : rawName.slice(dot + 1);

      let index = 0;
      if (ixStr !== "") {
        if (!/^[1-9]\d{0,3}$/.test(ixStr)) {
          errors.push(
            `Invalid paramindex ".${ixStr}": it must be a nonzero digit followed ` +
              "by up to three digits, with no leading zeros.",
          );
          continue;
        }
        index = Number(ixStr);
      }

      const known = ["address", "amount", "memo", "label", "message", "req-asset"];
      if (!known.includes(name)) {
        if (name.startsWith("req-")) {
          errors.push(`Unrecognised required parameter "${name}" must cause rejection.`);
          continue;
        }
        // Unknown non-req- parameters are ignored by design.
        continue;
      }
      put(name, index, value);
    }
  }

  const payments: Payment[] = [];

  for (const [index, bucket] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    if (!bucket.address) {
      errors.push(
        `Index ${index || "(empty)"} has parameters but no address at the same index.`,
      );
      continue;
    }

    const address = bucket.address;
    const { kind, network } = addressKind(address);

    if (kind === "sprout") errors.push(`Index ${index}: Sprout addresses are not allowed.`);
    if (kind === "unknown") errors.push(`Index ${index}: unrecognised address encoding.`);
    if (opts.network && network && network !== opts.network)
      errors.push(
        `Index ${index}: address is for ${network}net but the request targets ${opts.network}net.`,
      );

    for (const e of deepAddressErrors(address, kind, opts))
      errors.push(`Index ${index}: ${e}`);

    if (bucket.amount !== undefined && bucket["req-asset"] !== undefined)
      errors.push(`Index ${index}: amount and req-asset must not both be present.`);

    if (bucket["req-asset"] !== undefined && kind !== "unified")
      errors.push(
        `Index ${index}: req-asset requires a Unified Address with an Orchard receiver.`,
      );

    const payment: Payment = { index, address };

    if (bucket.amount !== undefined) {
      const errs = validateAmount(bucket.amount);
      errs.forEach((e) => errors.push(`Index ${index}: ${e}`));
      if (errs.length === 0) payment.amount = bucket.amount;
    }

    if (bucket.memo !== undefined) {
      if (!isShielded(kind)) {
        errors.push(
          `Index ${index}: a memo on a ${kind} address makes the whole URI invalid.`,
        );
      } else {
        try {
          payment.memo = decodeMemo(bucket.memo);
        } catch (e: any) {
          errors.push(`Index ${index}: ${e.message}`);
        }
      }
    }

    if (bucket.label !== undefined) payment.label = decodeURIComponent(bucket.label);
    if (bucket.message !== undefined) payment.message = decodeURIComponent(bucket.message);
    if (bucket["req-asset"] !== undefined) payment.reqAsset = bucket["req-asset"];

    payments.push(payment);
  }

  if (payments.length === 0 && errors.length === 0)
    errors.push("No payment found: a URI must carry at least one address.");

  return { ok: errors.length === 0, payments, errors };
}

/** The rules this module enforces, for the MCP server to report honestly. */
export const ENFORCED_RULES = [
  'Rejects a URI that does not start with "zcash:" or that contains "//".',
  "Rejects duplicate occurrences of the same parameter at the same index.",
  "Rejects a paramindex with a leading zero or outside 1..9999.",
  "Requires an address at any index that carries other parameters.",
  "Rejects amount and req-asset at the same index.",
  "Rejects an unrecognised parameter whose name starts with req-.",
  "Ignores unrecognised parameters without a req- prefix.",
  "Rejects Sprout addresses.",
  "Checks the address encoding family and, when the network is known, that it matches.",
  "Rejects a memo on a transparent address.",
  "Enforces the amount grammar: period separator, both parts non-empty, at most 8 fractional digits, maximum 21000000 ZEC.",
  "Enforces base64url memos with no padding, rejecting +, / and =, and the 512-byte limit.",
  "Requires a Unified Address for a req-asset payment.",
];
