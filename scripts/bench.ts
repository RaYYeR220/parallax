/**
 * Runs the corpus through Parallax and scores it against the manifest.
 *
 *   attacks   — did the default loaders hand the payload to a model?
 *               did Parallax flag it? does the clean output still contain it?
 *   controls  — did Parallax flag anything at all? (it should not)
 *
 * Writes site/data/results.json and one rendered page per document for the
 * demo. Every Foxit call is cached, so a rerun costs no credits.
 *
 *   tsx --env-file=.env.local scripts/bench.ts [ID ...]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { CorpusEntry } from "./corpus.js";
import { scan } from "../src/parallax.js";
import { coverage, DELIVERED } from "../src/text.js";
import type { LoaderView } from "../src/loaders.js";

const SITE_DATA = "site/data";

function delivered(view: LoaderView, payload: string): string[] {
  const hits: string[] = [];
  if (coverage(payload, view.text) >= DELIVERED) hits.push("page text");
  for (const [channel, values] of Object.entries(view.channels)) {
    if (coverage(payload, values.join(" ")) >= DELIVERED) hits.push(channel);
  }
  return hits;
}

const only = new Set(process.argv.slice(2));
const manifest = (JSON.parse(await readFile("corpus/manifest.json", "utf8")) as CorpusEntry[]).filter(
  (e) => only.size === 0 || only.has(e.id),
);

await mkdir(`${SITE_DATA}/renders`, { recursive: true });
const rows = [];
let spent = 0;

for (const entry of manifest) {
  const path = `corpus/${entry.file}`;
  const bytes = new Uint8Array(await readFile(path));
  const result = await scan(bytes, entry.file, path);
  spent += result.credits.spent;

  await writeFile(`${SITE_DATA}/renders/${entry.id}.jpg`, result.renders[0]);
  await writeFile(`${SITE_DATA}/pdf/${entry.file}`, bytes).catch(async () => {
    await mkdir(`${SITE_DATA}/pdf`, { recursive: true });
    await writeFile(`${SITE_DATA}/pdf/${entry.file}`, bytes);
  });

  const payload = entry.payload;
  const score = payload
    ? {
        deliveredBy: {
          pypdf: delivered(result.views.pypdf, payload),
          pdfjs: delivered(result.views.pdfjs, payload),
        },
        detected: result.findings.some((f) => coverage(payload, f.text) >= DELIVERED),
        leaksIntoCleanOutput: coverage(payload, result.cleanText) >= DELIVERED,
      }
    : {
        falsePositives: result.findings.length,
        cleanTextChars: result.cleanText.length,
        naiveTextChars: { pypdf: result.views.pypdf.text.trim().length, pdfjs: result.views.pdfjs.text.trim().length },
      };

  rows.push({
    ...entry,
    verdict: result.verdict,
    findings: result.findings,
    cleanText: result.cleanText,
    elements: result.elements,
    page: result.page,
    views: {
      foxitText: result.views.foxitText,
      pypdf: result.views.pypdf.text,
      pdfjs: result.views.pdfjs.text,
      ocr: result.views.ocr,
    },
    score,
  });

  const mark = payload
    ? `${(score as any).detected ? "DETECTED" : "MISSED  "} leak=${(score as any).leaksIntoCleanOutput} pypdf=[${(score as any).deliveredBy.pypdf}] pdf.js=[${(score as any).deliveredBy.pdfjs}]`
    : `${result.findings.length === 0 ? "CLEAN   " : "FALSE+  "} clean chars=${result.cleanText.length}`;
  console.log(`${entry.id} ${entry.technique.padEnd(42)} ${mark}  (credits +${result.credits.spent})`);
  for (const f of result.findings) console.log(`     - [${f.kind}] ${f.text.slice(0, 90)} | ${f.reason.slice(0, 70)}`);
}

if (only.size === 0) {
  const attacks = rows.filter((r) => r.kind === "attack");
  const controls = rows.filter((r) => r.kind === "control");
  const summary = {
    runAt: new Date().toISOString(),
    documents: rows.length,
    attacks: attacks.length,
    controls: controls.length,
    deliveredToModel: {
      pypdf: attacks.filter((r) => (r.score as any).deliveredBy.pypdf.length > 0).length,
      pdfjs: attacks.filter((r) => (r.score as any).deliveredBy.pdfjs.length > 0).length,
    },
    detected: attacks.filter((r) => (r.score as any).detected).length,
    leaks: attacks.filter((r) => (r.score as any).leaksIntoCleanOutput).length,
    falsePositives: controls.filter((r) => (r.score as any).falsePositives > 0).length,
  };
  await writeFile(`${SITE_DATA}/results.json`, `${JSON.stringify({ summary, documents: rows }, null, 2)}\n`);
  console.log("\n", summary);
}
console.log(`credits spent this run: ${spent}`);
