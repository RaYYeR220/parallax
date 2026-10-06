/**
 * What an agent's document loader actually reads, using the extractors the
 * common frameworks are built on. Nothing here talks to Foxit; this is the
 * baseline — the text a model is handed when nobody checks it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const run = promisify(execFile);

export interface LoaderView {
  /** The page text, as the loader joins it. */
  text: string;
  /** Text the file carries outside the page content: annotations, form values, metadata. */
  channels: { annotation: string[]; form: string[]; metadata: string[] };
  /** Text runs with their origin in PDF points, where the loader reports them. */
  items?: { text: string; x: number; y: number }[];
}

/** pdf.js — what pdf-parse, and so most JavaScript loaders, sit on. */
export async function pdfjsView(bytes: Uint8Array): Promise<LoaderView> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  const annotation: string[] = [];
  const form: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join(""),
    );
    for (const annot of await page.getAnnotations()) {
      const contents = typeof annot.contentsObj?.str === "string" ? annot.contentsObj.str : "";
      if (contents) annotation.push(contents);
      if (typeof annot.fieldValue === "string" && annot.fieldValue) form.push(annot.fieldValue);
    }
  }
  const meta = await doc.getMetadata();
  const info = (meta.info ?? {}) as Record<string, unknown>;
  const metadata = ["Title", "Subject", "Keywords", "Author"]
    .map((k) => info[k])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  await task.destroy();
  return { text: pages.join("\n"), channels: { annotation, form, metadata } };
}

const PYPDF = `
import json, sys
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
items = []
def visit(t, cm, tm, font, size):
    if t.strip():
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
        items.append({"text": t, "x": x, "y": y})
text = "\\n".join((p.extract_text(visitor_text=visit) or "") for p in r.pages)
annots, form = [], []
for p in r.pages:
    for a in (p.get("/Annots") or []):
        a = a.get_object()
        c = a.get("/Contents")
        if c: annots.append(str(c))
for name, f in (r.get_fields() or {}).items():
    v = f.get("/V")
    if v: form.append(str(v))
meta = r.metadata or {}
metadata = [str(meta[k]) for k in ("/Title", "/Subject", "/Keywords", "/Author") if meta.get(k)]
print(json.dumps({"text": text, "channels": {"annotation": annots, "form": form, "metadata": metadata}, "items": items}))
`;

/** pypdf — what LangChain's PyPDFLoader calls by default. */
export async function pypdfView(file: string): Promise<LoaderView> {
  const { stdout } = await run("python", ["-c", PYPDF, file], { maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout) as LoaderView;
}
