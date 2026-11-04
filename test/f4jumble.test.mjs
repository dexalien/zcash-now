// Verifies F4Jumble against the official vectors from
// zcash/zcash-test-vectors (test-vectors/json/f4jumble.json).
// The vectors are the only reason to trust this implementation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
import { pathToFileURL } from "node:url";
const { f4jumble, f4jumbleInverse } = await import(pathToFileURL(join(HERE, "..", "dist", "address.js")).href);

const raw = JSON.parse(readFileSync(join(HERE, "f4jumble-vectors.json"), "utf8"));
// The file starts with a provenance line and a header row.
const rows = raw.filter((r) => Array.isArray(r) && r.length === 2 && /^[0-9a-f]+$/i.test(r[0]));

let fwdOk = 0, invOk = 0, fail = [];
for (const [normalHex, jumbledHex] of rows) {
  const normal = Buffer.from(normalHex, "hex");
  const jumbled = Buffer.from(jumbledHex, "hex");
  const gotJumbled = f4jumble(normal);
  const gotNormal = f4jumbleInverse(jumbled);
  if (gotJumbled.equals(jumbled)) fwdOk++; else fail.push(`forward len=${normal.length}`);
  if (gotNormal.equals(normal)) invOk++; else fail.push(`inverse len=${jumbled.length}`);
}

console.log(`vectores: ${rows.length}`);
console.log(`f4jumble        ${fwdOk}/${rows.length}`);
console.log(`f4jumbleInverse ${invOk}/${rows.length}`);
if (fail.length) { console.log("FALLOS:", fail.slice(0, 6).join("; ")); process.exit(1); }

// Length limits must be enforced before inverting.
for (const bad of [37, 4194369]) {
  try { f4jumbleInverse(Buffer.alloc(bad)); console.log(`len ${bad} NO rechazado  <-- problema`); process.exit(1); }
  catch { console.log(`len ${bad} rechazado OK`); }
}
console.log("\nF4Jumble verificado contra los vectores oficiales.");
