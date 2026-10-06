/** Free check: which payloads do the common loaders hand to a model? */

import { readFile } from "node:fs/promises";
import type { CorpusEntry } from "./corpus.js";
import { pdfjsView, pypdfView, type LoaderView } from "../src/loaders.js";
import { coverage, DELIVERED } from "../src/text.js";

function where(view: LoaderView, payload: string): string {
  const hits: string[] = [];
  if (coverage(payload, view.text) >= DELIVERED) hits.push("text");
  for (const [channel, values] of Object.entries(view.channels)) {
    if (coverage(payload, values.join(" ")) >= DELIVERED) hits.push(channel);
  }
  return hits.length ? hits.join("+") : "-";
}

const manifest = JSON.parse(await readFile("corpus/manifest.json", "utf8")) as CorpusEntry[];
for (const entry of manifest) {
  const bytes = new Uint8Array(await readFile(`corpus/${entry.file}`));
  const [js, py] = await Promise.all([pdfjsView(bytes), pypdfView(`corpus/${entry.file}`)]);
  const line = entry.payload
    ? `pdf.js=${where(js, entry.payload)}  pypdf=${where(py, entry.payload)}`
    : `pdf.js chars=${js.text.trim().length}  pypdf chars=${py.text.trim().length}`;
  console.log(`${entry.id}  ${entry.technique.padEnd(42)} ${line}`);
}
