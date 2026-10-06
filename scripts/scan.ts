/**
 * Scan one PDF and print what a person cannot see in it.
 *
 *   npm run scan -- path/to/file.pdf [--json out.json]
 *
 * Exits 0 when the document is clean, 2 when something is hidden, so it can
 * sit in front of an ingestion step as a gate.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { scan } from "../src/parallax.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
if (!file) {
  console.error("usage: npm run scan -- <file.pdf> [--json out.json]");
  process.exit(1);
}

const result = await scan(new Uint8Array(await readFile(file)), basename(file), file);

console.log(`${basename(file)}: ${result.verdict === "clean" ? "clean" : `${result.findings.length} hidden item(s)`}`);
for (const finding of result.findings) {
  console.log(`\n  ${finding.text}`);
  console.log(`  ${finding.reason}`);
  for (const line of finding.evidence) console.log(`    - ${line}`);
  console.log(`    - extracted by ${finding.readBy.join(", ")}`);
}
console.log(`\nFoxit credits: ${result.credits.spent} spent, ${result.credits.cached} served from cache`);

if (jsonOut) {
  await writeFile(
    jsonOut,
    `${JSON.stringify({ verdict: result.verdict, findings: result.findings, cleanText: result.cleanText, elements: result.elements }, null, 2)}\n`,
  );
  console.log(`wrote ${jsonOut}`);
}
process.exit(result.verdict === "clean" ? 0 : 2);
