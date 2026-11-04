#!/usr/bin/env node
// Builds the public status page into public/ from the receipts the runner wrote.
// Run after `tsc`: it reads recipe and tool metadata from dist/.
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RECIPES } from "../dist/recipes.js";
import { TOOLS } from "../dist/facts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");
const receipts = JSON.parse(readFileSync(join(ROOT, "receipts.json"), "utf8"));
const historyFile = join(ROOT, "receipts-history.jsonl");
const history = existsSync(historyFile)
  ? readFileSync(historyFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];

const data = {
  generatedAt: receipts.generatedAt,
  endpoint: receipts.endpoint,
  blockHeight: receipts.blockHeight,
  summary: receipts.summary,
  runs: new Set(history.map((h) => h.ranAt.slice(0, 16))).size,
  recipes: RECIPES.map((r) => ({
    id: r.id,
    task: r.task,
    cost: r.cost,
    code: r.code,
    proves: r.proves,
    leaks: r.leaks,
    receipt: receipts.receipts.find((x) => x.recipeId === r.id) ?? null,
    history: history.filter((h) => h.recipeId === r.id).slice(-24),
  })),
  tools: TOOLS,
};

mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, "web"), OUT, { recursive: true });
writeFileSync(join(OUT, "data.json"), JSON.stringify(data, null, 2));
for (const f of ["receipts.json", "llms.txt", "receipts-history.jsonl", "STATUS.md"])
  if (existsSync(join(ROOT, f))) copyFileSync(join(ROOT, f), join(OUT, f));
console.log(`public/ built: ${data.recipes.length} recipes, ${history.length} history lines`);
