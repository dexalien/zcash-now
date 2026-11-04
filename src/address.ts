/**
 * Unified address decoding: Bech32m, then F4Jumble inverse, then typecodes.
 *
 * This exists because prefix matching is not validation. A startsWith check
 * accepts a corrupted address whose Bech32m checksum fails, rejects valid
 * Revision 2 forms, and cannot see the MUST-understand metadata that ZIP 316
 * says must cause outright rejection.
 *
 * F4Jumble is implemented from the ZIP 316 specification and verified against
 * the official test vectors in zcash/zcash-test-vectors. It is not written
 * from memory: see test/f4jumble.test.mjs.
 *
 * Spec: https://zips.z.cash/zip-0316
 */

import blake2b from "blake2b";
import { bech32m } from "bech32";
import { HRPS, TYPECODES, classifyUnknownTypecode, typecode } from "./facts.js";

// ---------------------------------------------------------------------------
// F4Jumble
// ---------------------------------------------------------------------------

/** Hash output length, in bytes. */
const L_H = 64;
export const F4JUMBLE_MIN_BYTES = 38;
/** (2^16 + 1) * L_H */
export const F4JUMBLE_MAX_BYTES = (2 ** 16 + 1) * L_H;

const PERSONAL_H = Buffer.from("UA_F4Jumble_H", "latin1");
const PERSONAL_G = Buffer.from("UA_F4Jumble_G", "latin1");

function xorInto(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** H_i(u): BLAKE2b with output length l_L, personalized "UA_F4Jumble_H" || [i,0,0]. */
function hashH(i: number, u: Buffer, lL: number): Buffer {
  const personal = Buffer.concat([PERSONAL_H, Buffer.from([i, 0, 0])]);
  const out = Buffer.alloc(lL);
  blake2b(lL, null, null, personal).update(u).digest(out);
  return out;
}

/**
 * G_i(u): the first l_R bytes of the concatenation, over j, of BLAKE2b-512
 * personalized "UA_F4Jumble_G" || [i] || I2LEOSP_16(j).
 */
function hashG(i: number, u: Buffer, lR: number): Buffer {
  const blocks = Math.ceil(lR / L_H);
  const parts: Buffer[] = [];
  for (let j = 0; j < blocks; j++) {
    const jLe = Buffer.alloc(2);
    jLe.writeUInt16LE(j, 0);
    const personal = Buffer.concat([PERSONAL_G, Buffer.from([i]), jLe]);
    const out = Buffer.alloc(L_H);
    blake2b(L_H, null, null, personal).update(u).digest(out);
    parts.push(out);
  }
  return Buffer.concat(parts).subarray(0, lR);
}

function splitLengths(lM: number): { lL: number; lR: number } {
  const lL = Math.min(L_H, Math.floor(lM / 2));
  return { lL, lR: lM - lL };
}

function checkLength(lM: number): void {
  if (lM < F4JUMBLE_MIN_BYTES || lM > F4JUMBLE_MAX_BYTES)
    throw new Error(
      `F4Jumble input must be between ${F4JUMBLE_MIN_BYTES} and ` +
        `${F4JUMBLE_MAX_BYTES} bytes; got ${lM}.`,
    );
}

export function f4jumble(m: Buffer): Buffer {
  checkLength(m.length);
  const { lL, lR } = splitLengths(m.length);
  const a = m.subarray(0, lL);
  const b = m.subarray(lL);

  const x = xorInto(b, hashG(0, a, lR));
  const y = xorInto(a, hashH(0, x, lL));
  const d = xorInto(x, hashG(1, y, lR));
  const c = xorInto(y, hashH(1, d, lL));

  return Buffer.concat([c, d]);
}

export function f4jumbleInverse(j: Buffer): Buffer {
  checkLength(j.length);
  const { lL, lR } = splitLengths(j.length);
  const c = j.subarray(0, lL);
  const d = j.subarray(lL);

  const y = xorInto(c, hashH(1, d, lL));
  const x = xorInto(d, hashG(1, y, lR));
  const a = xorInto(y, hashH(0, x, lL));
  const b = xorInto(x, hashG(0, a, lR));

  return Buffer.concat([a, b]);
}

// ---------------------------------------------------------------------------
// Unified address structure
// ---------------------------------------------------------------------------

export type Revision = "R0" | "R2-zu" | "R2-tu";
export type Network = "main" | "test";

export interface Receiver {
  typecode: number;
  name: string;
  length: number;
  /** Hex of the raw receiver bytes, for callers that want to go further. */
  data: string;
  shielded: boolean;
  mustUnderstand: boolean;
  /** Set for 0xE0 and 0xE1. See expiryEncodingVerified. */
  expiry?: { kind: "height" | "time"; value: string };
}

export interface DecodedAddress {
  valid: boolean;
  address: string;
  hrp?: string;
  network?: Network;
  revision?: Revision;
  kind?: "address" | "ufvk" | "uivk";
  receivers: Receiver[];
  /** Which receiver a conforming sender must use (ZIP 316 preference order). */
  senderShouldUse?: { typecode: number; name: string };
  canReceiveShielded?: boolean;
  errors: string[];
  warnings: string[];
  /**
   * The integer encoding of expiry metadata values is read as little-endian,
   * the convention used throughout the ZIPs, but is not covered by the
   * F4Jumble test vectors and so is not independently verified here. When an
   * expiry is present and no reference height or time was supplied, the
   * address is rejected rather than accepted on an unchecked reading.
   */
  expiryEncodingVerified: false;
}

const ALL_UA_HRPS: Array<{ hrp: string; network: Network; revision: Revision }> = [
  { hrp: HRPS.ua.r0.main, network: "main", revision: "R0" },
  { hrp: HRPS.ua.r0.test, network: "test", revision: "R0" },
  { hrp: HRPS.ua.r2ShieldedOnly.main, network: "main", revision: "R2-zu" },
  { hrp: HRPS.ua.r2ShieldedOnly.test, network: "test", revision: "R2-zu" },
  { hrp: HRPS.ua.r2TransparentEnabled.main, network: "main", revision: "R2-tu" },
  { hrp: HRPS.ua.r2TransparentEnabled.test, network: "test", revision: "R2-tu" },
];

const VIEWING_HRPS: Array<{ hrp: string; network: Network; kind: "ufvk" | "uivk" }> = [
  { hrp: HRPS.ufvk.r0.main, network: "main", kind: "ufvk" },
  { hrp: HRPS.ufvk.r0.test, network: "test", kind: "ufvk" },
  { hrp: HRPS.ufvk.r2.main, network: "main", kind: "ufvk" },
  { hrp: HRPS.ufvk.r2.test, network: "test", kind: "ufvk" },
  { hrp: HRPS.uivk.r0.main, network: "main", kind: "uivk" },
  { hrp: HRPS.uivk.r0.test, network: "test", kind: "uivk" },
  { hrp: HRPS.uivk.r2.main, network: "main", kind: "uivk" },
  { hrp: HRPS.uivk.r2.test, network: "test", kind: "uivk" },
];

/** Bitcoin-style compactSize. */
function readCompactSize(buf: Buffer, offset: number): { value: number; next: number } {
  const first = buf[offset];
  if (first === undefined) throw new Error("Truncated: expected a compactSize.");
  if (first < 0xfd) return { value: first, next: offset + 1 };
  if (first === 0xfd) {
    if (offset + 3 > buf.length) throw new Error("Truncated compactSize (0xfd).");
    return { value: buf.readUInt16LE(offset + 1), next: offset + 3 };
  }
  if (first === 0xfe) {
    if (offset + 5 > buf.length) throw new Error("Truncated compactSize (0xfe).");
    return { value: buf.readUInt32LE(offset + 1), next: offset + 5 };
  }
  throw new Error("compactSize of 0xff is not used in a unified address.");
}

function writeCompactSize(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n, 1);
  return b;
}

/**
 * Encode a unified address from its receivers.
 *
 * Present so the decoder can be round-tripped, and so tests and recipes can
 * use a *valid* testnet address instead of a placeholder. A recipe that claims
 * to prove something should not rest on a made-up address.
 */
export function encodeUnifiedAddress(
  receivers: Array<{ typecode: number; data: Buffer }>,
  hrp: string,
): string {
  if (receivers.length === 0) throw new Error("At least one receiver is required.");

  const sorted = [...receivers].sort((a, b) => a.typecode - b.typecode);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].typecode === sorted[i - 1].typecode)
      throw new Error(`Typecode 0x${sorted[i].typecode.toString(16)} appears twice.`);

  const body = Buffer.concat(
    sorted.flatMap((r) => [
      writeCompactSize(r.typecode),
      writeCompactSize(r.data.length),
      r.data,
    ]),
  );

  const padding = Buffer.alloc(16);
  Buffer.from(hrp, "latin1").copy(padding);

  const jumbled = f4jumble(Buffer.concat([body, padding]));
  return bech32m.encode(hrp, bech32m.toWords(jumbled), F4JUMBLE_MAX_BYTES);
}

export interface DecodeOptions {
  /** Current chain height, to evaluate a 0xE0 expiry. */
  height?: number;
  /** Current unix time in seconds, to evaluate a 0xE1 expiry. */
  now?: number;
  /** Reject the address if it is not for this network. */
  network?: Network;
}

export function decodeUnifiedAddress(
  address: string,
  opts: DecodeOptions = {},
): DecodedAddress {
  const result: DecodedAddress = {
    valid: false,
    address,
    receivers: [],
    errors: [],
    warnings: [],
    expiryEncodingVerified: false,
  };

  const trimmed = address.trim();

  // 0. Case. Bech32 permits all-lower or all-upper and requires mixed case to
  //    be rejected, because mixing it breaks the checksum's case guarantee.
  //    Lower-casing first would launder an invalid address into a valid one,
  //    which is the exact failure this module exists to prevent.
  if (/[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed)) {
    result.errors.push(
      "Mixed case. A Bech32m string must be entirely lower case or entirely " +
        "upper case; a mixed-case string must be rejected, not normalised.",
    );
    return result;
  }

  // 1. Bech32m. A failing checksum is the whole point of decoding rather than
  //    prefix-matching, so it is an error, not a warning.
  let decoded;
  try {
    decoded = bech32m.decode(trimmed.toLowerCase(), F4JUMBLE_MAX_BYTES);
  } catch (e: any) {
    result.errors.push(
      `Bech32m decoding failed: ${e?.message ?? e}. A prefix check would have ` +
        "accepted this.",
    );
    return result;
  }

  const hrp = decoded.prefix;
  result.hrp = hrp;

  const asAddress = ALL_UA_HRPS.find((h) => h.hrp === hrp);
  const asViewing = VIEWING_HRPS.find((h) => h.hrp === hrp);

  if (!asAddress && !asViewing) {
    result.errors.push(
      `Unknown human-readable prefix "${hrp}". Unified addresses use u/utest ` +
        "(Revision 0), zu/zutest (Revision 2 shielded-only) or tu/tutest " +
        "(Revision 2 transparent-enabled).",
    );
    return result;
  }

  result.network = (asAddress ?? asViewing)!.network;
  result.kind = asViewing ? asViewing.kind : "address";
  if (asAddress) result.revision = asAddress.revision;

  if (opts.network && result.network !== opts.network)
    result.errors.push(
      `This is a ${result.network}net ${result.kind}, but ${opts.network}net was required.`,
    );

  // 2. F4Jumble inverse.
  const jumbled = Buffer.from(bech32m.fromWords(decoded.words));
  let unjumbled: Buffer;
  try {
    unjumbled = f4jumbleInverse(jumbled);
  } catch (e: any) {
    result.errors.push(`F4Jumble inverse failed: ${e?.message ?? e}`);
    return result;
  }

  // 3. Strip and check the 16-byte zero-padded HRP.
  if (unjumbled.length < 16) {
    result.errors.push("Too short to carry the 16-byte HRP padding.");
    return result;
  }
  const padding = unjumbled.subarray(unjumbled.length - 16);
  const expected = Buffer.alloc(16);
  Buffer.from(hrp, "latin1").copy(expected);
  if (!padding.equals(expected)) {
    result.errors.push(
      "The trailing 16-byte padding does not match the zero-padded HRP, so " +
        "this encoding is malformed.",
    );
    return result;
  }
  const body = unjumbled.subarray(0, unjumbled.length - 16);

  // 4. Parse receivers.
  let offset = 0;
  let lastTypecode = -1;
  const seen = new Set<number>();

  while (offset < body.length) {
    let tc: number, len: number;
    try {
      const a = readCompactSize(body, offset);
      tc = a.value;
      const b = readCompactSize(body, a.next);
      len = b.value;
      offset = b.next;
    } catch (e: any) {
      result.errors.push(e?.message ?? String(e));
      return result;
    }

    if (offset + len > body.length) {
      result.errors.push(
        `Receiver 0x${tc.toString(16)} claims ${len} bytes but only ` +
          `${body.length - offset} remain.`,
      );
      return result;
    }
    const data = body.subarray(offset, offset + len);
    offset += len;

    // Ordering and duplication (ZIP 316).
    if (tc <= lastTypecode)
      result.errors.push(
        `Items must be in ascending typecode order; 0x${tc.toString(16)} follows ` +
          `0x${lastTypecode.toString(16)}.`,
      );
    if (seen.has(tc))
      result.errors.push(`Typecode 0x${tc.toString(16)} appears more than once.`);
    lastTypecode = tc;
    seen.add(tc);

    const known = typecode(tc);
    const cls = known
      ? { mustUnderstand: known.mustUnderstand, kind: known.name }
      : classifyUnknownTypecode(tc);

    const receiver: Receiver = {
      typecode: tc,
      name: known?.name ?? cls.kind,
      length: len,
      data: data.toString("hex"),
      shielded: known?.shielded ?? false,
      mustUnderstand: cls.mustUnderstand,
    };

    // Expiry metadata. We recognise these, so we may not simply ignore them.
    if (tc === 0xe0 || tc === 0xe1) {
      const kind = tc === 0xe0 ? ("height" as const) : ("time" as const);
      let value: bigint | null = null;
      try {
        if (len === 8) value = Buffer.from(data).readBigUInt64LE(0);
        else if (len > 0 && len <= 6) value = BigInt(Buffer.from(data).readUIntLE(0, len));
      } catch {
        value = null;
      }
      receiver.expiry = { kind, value: value === null ? "unreadable" : String(value) };

      const reference = kind === "height" ? opts.height : opts.now;
      if (reference === undefined) {
        result.errors.push(
          `This address carries an expiry (${kind}) and is MUST-understand, but ` +
            `no current ${kind} was supplied to evaluate it against. Pass ` +
            `${kind === "height" ? "height" : "now"} or reject the address: ` +
            "accepting it would mean ignoring metadata ZIP 316 forbids ignoring.",
        );
      } else if (value === null) {
        result.errors.push(
          `This address carries an unreadable ${kind} expiry of ${len} bytes. ` +
            "Rejecting, since ignoring it is not permitted.",
        );
      } else if (value < BigInt(reference)) {
        result.errors.push(
          `This address expired: ${kind} ${value} is in the past (current ${reference}).`,
        );
      }
    } else if (cls.mustUnderstand) {
      result.errors.push(
        `Typecode 0x${tc.toString(16)} is ${cls.kind}. ZIP 316 requires rejecting ` +
          "the whole address rather than ignoring it.",
      );
    } else if (!known) {
      result.warnings.push(
        `Typecode 0x${tc.toString(16)} is ${cls.kind} and may be ignored.`,
      );
    }

    result.receivers.push(receiver);
  }

  // 5. Structural rules.
  const nonMetadata = result.receivers.filter((r) => r.typecode < 0xc0);
  if (nonMetadata.length === 0)
    result.errors.push("Must contain at least one non-metadata item.");

  const hasShielded = result.receivers.some((r) => r.shielded);
  const transparent = result.receivers.filter(
    (r) => r.typecode === 0x00 || r.typecode === 0x01,
  );

  if (result.kind === "address" && result.revision === "R0" && !hasShielded)
    result.errors.push("A Revision 0 unified address must contain at least one shielded item.");

  if (result.revision === "R2-zu" && transparent.length > 0)
    result.errors.push(
      "A zu address must not contain transparent items, but it does.",
    );

  if (seen.has(0x00) && seen.has(0x01))
    result.errors.push("Must not include both P2PKH and P2SH transparent items.");

  if (result.revision === "R0" && result.receivers.some((r) => r.typecode >= 0xe0 && r.typecode <= 0xfc))
    result.errors.push("A Revision 0 unified address must not contain MUST-understand metadata.");

  // 6. Sender preference: Orchard, then Sapling, then P2SH, then P2PKH.
  for (const tc of [0x03, 0x02, 0x01, 0x00]) {
    if (seen.has(tc)) {
      result.senderShouldUse = { typecode: tc, name: typecode(tc)!.name };
      break;
    }
  }

  result.canReceiveShielded = hasShielded;
  result.valid = result.errors.length === 0;
  return result;
}

/**
 * Note worth returning with any shielded-capability answer: there is no
 * Ironwood receiver type, so 0x03 is the right thing to look for.
 */
export const IRONWOOD_NOTE =
  "Typecode 0x03 is named Orchard and is how Ironwood funds are received " +
  "after NU6.3. There is no Ironwood receiver type, format or encoding.";

export const KNOWN_TYPECODES = TYPECODES.map((t) => t.code);
