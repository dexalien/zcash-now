// Decodes the official unified-address vectors from zcash/zcash-test-vectors
// and checks that the receivers we parse are the ones the vector declares.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const { decodeUnifiedAddress } = await import(pathToFileURL(join(HERE, "..", "dist", "address.js")).href);

const raw = JSON.parse(readFileSync(join(HERE, "unified-address-vectors.json"), "utf8"));
const rows = raw.filter((r) => Array.isArray(r) && r.length >= 7 && typeof r[6] === "string");
console.log("filas con unified_addr:", rows.length);
console.log("muestra:", String(rows[0][6]).slice(0, 70));

let decoded = 0, matched = 0, problems = [];
for (const row of rows) {
  const [p2pkh, p2sh, sapling, orchard, unknownTc, unknownBytes, ua] = row;
  // The vector stores the address as hex of its ASCII bytes.
  const addr = /^[0-9a-f]+$/i.test(ua) ? Buffer.from(ua, "hex").toString("ascii") : ua;
  const r = decodeUnifiedAddress(addr);
  if (!r.hrp) { problems.push(`no hrp: ${addr.slice(0,24)} :: ${r.errors[0]}`); continue; }
  decoded++;

  const got = new Map(r.receivers.map((x) => [x.typecode, x.data]));
  const want = [[0x00, p2pkh], [0x01, p2sh], [0x02, sapling], [0x03, orchard]];
  let ok = true;
  for (const [tc, hex] of want) {
    if (hex && got.get(tc) !== hex) { ok = false; problems.push(`tc 0x${tc.toString(16)} mismatch`); }
    if (!hex && got.has(tc)) { ok = false; problems.push(`tc 0x${tc.toString(16)} unexpected`); }
  }
  if (unknownTc && got.get(Number(unknownTc)) !== unknownBytes) {
    ok = false; problems.push(`unknown tc ${unknownTc} mismatch`);
  }
  if (ok) matched++;
}
console.log(`\ndecodificadas       ${decoded}/${rows.length}`);
console.log(`receivers correctos ${matched}/${rows.length}`);
if (problems.length) console.log("\nproblemas:", [...new Set(problems)].slice(0,6).join("; "));

console.log("\n=== reglas que DEBEN rechazar ===");
const sample = String(rows[0][6]);
const valid = /^[0-9a-f]+$/i.test(sample) ? Buffer.from(sample, "hex").toString("ascii") : sample;

const checks = [
  ["checksum roto", "u1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"],
  ["hrp inventado", "zq1abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz"],
  ["vacio", ""],
  // Regresion: lower-casing a mixed-case string would launder an invalid
  // address into a valid one. Bech32 requires rejecting mixed case.
  ["mayusculas mezcladas", valid.slice(0, 10) + valid.slice(10).toUpperCase()],
];
for (const [name, a] of checks) {
  const r = decodeUnifiedAddress(a);
  console.log(`  ${name}: ${r.valid ? "ACEPTADO <-- problema" : "rechazado OK -> " + (r.errors[0]||"").slice(0,58)}`);
}
if (decoded === 0) process.exit(1);

console.log("");
console.log("=== mayusculas completas DEBEN aceptarse (son validas por spec) ===");
const up = decodeUnifiedAddress(valid.toUpperCase());
console.log(`  toda mayuscula: ${up.valid ? "aceptada OK" : "RECHAZADA <-- problema: " + (up.errors[0]||"")}`);
if (!up.valid) process.exit(1);
