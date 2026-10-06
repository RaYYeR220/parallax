/** Writes the benchmark table into README.md from site/data/results.json. */

import { readFile, writeFile } from "node:fs/promises";

const { summary, documents } = JSON.parse(await readFile("site/data/results.json", "utf8"));

const label: Record<string, string> = { "page text": "page text", annotation: "annotation", form: "form value", metadata: "metadata" };
const extracted = (list: string[]) => (list.length ? list.map((c) => label[c] ?? c).join(", ") : "no");

const rows = documents.map((d: any) =>
  d.kind === "attack"
    ? `| ${d.id} | ${d.document} | ${d.technique} | ${extracted(d.score.deliveredBy.pypdf)} | ${extracted(d.score.deliveredBy.pdfjs)} | ${d.score.detected ? "**flagged**" : "missed"} | ${d.score.leaksIntoCleanOutput ? "yes" : "no"} |`
    : `| ${d.id} | ${d.document} (control) | ${d.technique} | n/a | n/a | ${d.score.falsePositives ? "**false alarm**" : "nothing flagged"} | n/a |`,
);

const run = new Date(summary.runAt).toISOString().slice(0, 10);
const table = [
  `Run against Foxit PDF Services on ${run}.`,
  "",
  "| | Document | How it is hidden | pypdf extracts it | pdf.js extracts it | Parallax | Left in Parallax output |",
  "|---|---|---|---|---|---|---|",
  ...rows,
].join("\n");

const readme = await readFile("README.md", "utf8");
const next = readme.replace(
  /<!-- results:start -->[\s\S]*<!-- results:end -->/,
  `<!-- results:start -->\n${table}\n<!-- results:end -->`,
);
await writeFile("README.md", next);
console.log(`README updated: ${summary.detected}/${summary.attacks} flagged, ${summary.falsePositives} false alarms`);
