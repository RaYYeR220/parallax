/**
 * Parallax: compare what a document's readers extract with what its pages show.
 *
 * Two views of the same file disagree only where something is hidden. The
 * reader view is the text layer, as the loaders agents actually use extract
 * it. The human view is the page rendered to pixels by Foxit and read back by
 * Foxit's OCR — what a person looking at the document would see. Text in the
 * first and not the second is text a model will act on that no human has read.
 *
 * Foxit's structural analysis then explains each finding where it can (a 0.5 pt
 * font, a box outside the page) and supplies the clean, structured output: the
 * document's elements, keeping only the ones the human view confirms.
 */

import JSZip from "jszip";
import { diffArrays } from "diff";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { operate, ROUTES } from "./foxit.js";
import { pdfjsView, pypdfView, type LoaderView } from "./loaders.js";
import { coverage, sameToken, tokens } from "./text.js";

export interface Finding {
  kind: "hidden-on-page" | "unseen-channel";
  text: string;
  /** Which readers would hand this text to a model. */
  readBy: string[];
  reason: string;
  evidence: string[];
  /** Where on the page it sits, in PDF points from the bottom-left, when known. */
  box: [number, number, number, number] | null;
}

export interface StructuredElement {
  type: string;
  text: string;
  fontSize: number | null;
}

export interface ScanResult {
  verdict: "clean" | "suspicious";
  findings: Finding[];
  /** Text a human can see on the page — what the agent should be given. */
  cleanText: string;
  /** Foxit's layout analysis, restricted to elements the rendered page confirms. */
  elements: StructuredElement[];
  views: {
    foxitText: string;
    pypdf: LoaderView;
    pdfjs: LoaderView;
    ocr: string;
  };
  /** The rendered page images, as Foxit produced them. */
  renders: Uint8Array[];
  page: { width: number; height: number };
  credits: { spent: number; cached: number };
}

const MIN_SPAN_TOKENS = 4;
/** A span is hidden when the rendered page holds fewer than this share of its words anywhere. */
const VISIBLE_SHARE = 0.5;
const MICROSCOPIC_PT = 3;
const CHANNEL_MIN_WORDS = 6;

export async function scan(bytes: Uint8Array, fileName: string, path: string): Promise<ScanResult> {
  const credits = { spent: 0, cached: 0 };
  const foxit = async (input: Uint8Array, name: string, route: string, params: Record<string, unknown> = {}) => {
    const result = await operate(input, name, route, params);
    credits[result.cached ? "cached" : "spent"] += 1;
    return result.bytes;
  };

  // Reader view: what loaders extract.
  const [foxitTextBytes, pypdf, pdfjs] = await Promise.all([
    foxit(bytes, fileName, ROUTES.pdfToText),
    pypdfView(path),
    pdfjsView(bytes),
  ]);
  const foxitText = new TextDecoder().decode(foxitTextBytes);

  // Human view: Foxit renders the pages, rebuilds them from pixels, and OCRs them.
  const imageArchive = await foxit(bytes, fileName, ROUTES.pdfToImage, {
    config: { imageFormat: "jpg", dpi: 300 },
  });
  const renders = await unzipImages(imageArchive);
  const ocrPages: string[] = [];
  for (const [i, image] of renders.entries()) {
    const imagePdf = await foxit(image, `page-${i + 1}.jpg`, ROUTES.pdfFromImage);
    const ocrPdf = await foxit(imagePdf, `page-${i + 1}.pdf`, ROUTES.pdfOcr);
    ocrPages.push((await pdfjsView(ocrPdf)).text);
  }
  const ocr = ocrPages.join("\n");

  // Structure: Foxit's own reading of the layout.
  const structureArchive = await foxit(bytes, fileName, ROUTES.structural);
  const structure = await readStructure(structureArchive);

  // pdf.js drops text it would never paint; pypdf keeps it, with its origin.
  const positions = [
    ...(await textPositions(bytes)),
    ...(pypdf.items ?? []).map((i): Positioned => ({ text: i.text, box: [i.x, i.y, 0, 0] })),
  ];
  const findings: Finding[] = [];

  // Page text that some reader extracts and the rendered page does not show.
  const readers: Record<string, string> = { "Foxit pdf-to-text": foxitText, pypdf: pypdf.text, "pdf.js": pdfjs.text };
  const ocrTokens = tokens(ocr);
  for (const [reader, text] of Object.entries(readers)) {
    for (const span of hiddenSpans(text, ocrTokens)) {
      const existing = findings.find((f) => f.kind === "hidden-on-page" && overlaps(f.text, span));
      if (existing) {
        if (!existing.readBy.includes(reader)) existing.readBy.push(reader);
        if (span.length > existing.text.length) existing.text = span;
        continue;
      }
      findings.push({ kind: "hidden-on-page", text: span, readBy: [reader], reason: "", evidence: [], box: null });
    }
  }
  for (const finding of findings) explain(finding, structure, positions);

  // Text the file carries outside the page: annotations, form values, metadata.
  for (const channel of ["annotation", "form", "metadata"] as const) {
    const values = new Map<string, string[]>();
    for (const [reader, view] of [["pypdf", pypdf], ["pdf.js", pdfjs]] as const) {
      for (const value of view.channels[channel]) {
        if (tokens(value).length < CHANNEL_MIN_WORDS) continue;
        values.set(value, [...(values.get(value) ?? []), reader]);
      }
    }
    for (const [value, readBy] of values) {
      findings.push({
        kind: "unseen-channel",
        text: value,
        readBy,
        reason: CHANNEL_REASONS[channel],
        evidence: [`${channel} text, never painted on the page`],
        box: null,
      });
    }
  }

  // The clean output: only what the human view confirms.
  const confirmed = (text: string) => coverage(text, ocr) >= 1 - VISIBLE_SHARE || tokens(text).length === 0;
  const textLines = foxitText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const cleanText =
    textLines.length > 0
      ? textLines.filter((line) => confirmed(line)).join("\n")
      : ocr.trim(); // A scan has no text layer; what a human sees is the OCR.
  const elements = structure.elements.filter((e) => confirmed(e.text));

  return {
    verdict: findings.length > 0 ? "suspicious" : "clean",
    findings,
    cleanText,
    elements,
    views: { foxitText, pypdf, pdfjs, ocr },
    renders,
    page: structure.page,
    credits,
  };
}

/* ------------------------------------------------------------------- diff */

/**
 * Runs of reader words the rendered page does not contain. The alignment finds
 * the runs; the second test — are most of the run's words anywhere on the
 * page? — throws out runs that only exist because OCR misread a visible line.
 */
export function hiddenSpans(readerText: string, ocrTokens: string[]): string[] {
  const words = readerText.split(/\s+/).filter((w) => tokens(w).length > 0);
  const readerTokens = words.map((w) => tokens(w).join(""));
  const parts = diffArrays(readerTokens, ocrTokens, { comparator: sameToken });

  const runs: number[][] = [];
  let index = 0;
  let current: number[] = [];
  let gap = 0;
  for (const part of parts) {
    if (part.removed) {
      for (let k = 0; k < part.count!; k += 1) current.push(index + k);
      index += part.count!;
      gap = 0;
    } else if (!part.added) {
      // A word or two of agreement inside a hidden run is usually a stop word.
      if (current.length > 0 && part.count! <= 2 && gap === 0) {
        for (let k = 0; k < part.count!; k += 1) current.push(index + k);
        gap = part.count!;
      } else {
        if (current.length > 0) runs.push(current.slice(0, current.length - gap));
        current = [];
        gap = 0;
      }
      index += part.count!;
    }
  }
  if (current.length > 0) runs.push(current.slice(0, current.length - gap));

  const ocrBag = new Set(ocrTokens);
  return runs
    .filter((run) => run.length >= MIN_SPAN_TOKENS)
    .map((run) => words.slice(run[0], run[run.length - 1] + 1).join(" "))
    .filter((span) => {
      const distinctive = tokens(span).filter((t) => t.length > 3);
      if (distinctive.length < 2) return false;
      const seen = distinctive.filter((t) => ocrBag.has(t)).length / distinctive.length;
      return seen < VISIBLE_SHARE;
    });
}

function overlaps(a: string, b: string): boolean {
  return coverage(a, b) >= 0.5 || coverage(b, a) >= 0.5;
}

/* ------------------------------------------------------------ explanation */

const CHANNEL_REASONS = {
  annotation: "Carried in an annotation, not in the page content. No one reading the page sees it.",
  form: "Carried as a form field value whose widget is not shown.",
  metadata: "Carried in the document metadata, which loaders attach to every chunk.",
} as const;

interface Structure {
  page: { width: number; height: number };
  elements: (StructuredElement & { box: number[] | null })[];
}

function explain(finding: Finding, structure: Structure, positions: Positioned[]): void {
  const element = structure.elements.find((e) => coverage(finding.text, e.text) >= 0.6);
  const position = locate(finding.text, positions);
  finding.box = position;

  if (element?.fontSize !== null && element?.fontSize !== undefined && element.fontSize < MICROSCOPIC_PT) {
    finding.reason = `Set in ${element.fontSize} pt type — present in the text layer, too small to read on any screen or print.`;
    finding.evidence.push(`Foxit structural analysis: fontSize ${element.fontSize}`);
  } else if (position && outside(position, structure.page)) {
    finding.reason = "Placed outside the page, where it is never displayed or printed.";
  } else {
    finding.reason =
      "Present in the text layer and absent from the rendered page — painted invisibly (colour, transparency, a covering shape, clipping or an invisible render mode).";
  }
  finding.evidence.push("Not in the OCR of Foxit's render of the page");
  if (!element) finding.evidence.push("Not among the elements Foxit's layout analysis reports");
  if (position && outside(position, structure.page)) {
    finding.evidence.push(`Text origin at x=${Math.round(position[0])}, outside the ${structure.page.width} pt page`);
  }
}

function outside(box: [number, number, number, number], page: { width: number; height: number }): boolean {
  const [x, y] = box;
  return x < 0 || y < 0 || x > page.width || y > page.height;
}

interface Positioned {
  text: string;
  box: [number, number, number, number];
}

async function textPositions(bytes: Uint8Array): Promise<Positioned[]> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent({ disableNormalization: true });
  const items: Positioned[] = [];
  for (const item of content.items) {
    if (!("str" in item) || item.str.trim().length === 0) continue;
    const [, , , d, x, y] = item.transform as number[];
    items.push({ text: item.str, box: [x, y, item.width, Math.max(item.height, Math.abs(d))] });
  }
  await task.destroy();
  return items;
}

function locate(text: string, positions: Positioned[]): [number, number, number, number] | null {
  const hit = positions.find((p) => coverage(p.text, text) >= 0.6 && tokens(p.text).length >= 3);
  return hit ? hit.box : null;
}

/* -------------------------------------------------------------- unpacking */

async function unzipImages(archive: Uint8Array): Promise<Uint8Array[]> {
  if (archive[0] === 0xff && archive[1] === 0xd8) return [archive];
  const zip = await JSZip.loadAsync(archive);
  const names = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return Promise.all(names.map((n) => zip.files[n].async("uint8array")));
}

async function readStructure(archive: Uint8Array): Promise<Structure> {
  const zip = await JSZip.loadAsync(archive);
  const entry = Object.values(zip.files).find((f) => f.name.endsWith("StructureInfo.json"));
  if (!entry) throw new Error("structural analysis returned no StructureInfo.json");
  const json = JSON.parse(await entry.async("string"));
  const result = json.analyzeResult;
  const size = result.pages?.[0]?.size ?? { width: 612, height: 792 };
  const elements = (result.elements ?? []).map((e: any) => ({
    type: String(e.type),
    text: String(e.content?.text ?? ""),
    fontSize: typeof e.content?.style?.fontSize === "number" ? e.content.style.fontSize : null,
    box: Array.isArray(e.region?.boundingBox) ? e.region.boundingBox : null,
  }));
  return { page: { width: size.width, height: size.height }, elements };
}
