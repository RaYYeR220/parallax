/**
 * Renders the demo page for review and exports the deck as PDF and PPTX.
 *
 * The deck is HTML so it shares the demo's components and data; each slide is
 * captured at 1920x1080 and the PPTX carries those captures, with the slide's
 * text in the speaker notes, so it can be dropped into another deck as is.
 *
 *   tsx scripts/export.ts [public-url]
 */

import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { createRequire } from "node:module";

// pptxgenjs ships CommonJS; its typings do not describe the ESM default export.
const PptxGen = createRequire(import.meta.url)("pptxgenjs");

const ROOT = "site";
const OUT = "out";
const PUBLIC_URL = process.argv[2] ?? "";

const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf",
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^([\\/])+/, "");
  const file = join(ROOT, path === "" || path === "." ? "index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(4319, resolve));
const BASE = "http://localhost:4319";

await rm(`${OUT}/qa`, { recursive: true, force: true });
await rm(`${OUT}/deck`, { recursive: true, force: true });
await mkdir(`${OUT}/qa`, { recursive: true });
await mkdir(`${OUT}/deck`, { recursive: true });

const browser = await chromium.launch();

// Demo page, desktop and phone, with the hero in both views.
for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/qa/${name}-full.png`, fullPage: true });
  await page.locator("#hero-specimen .lamp-btn[data-view=model]").click();
  await page.waitForTimeout(900);
  await page.locator(".hero").screenshot({ path: `${OUT}/qa/${name}-hero-model.png` });
  await page.locator(".doc").nth(2).click();
  await page.waitForTimeout(900);
  await page.locator("#detail").screenshot({ path: `${OUT}/qa/${name}-detail.png` });
  await page.close();
}

// Deck.
const deck = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await deck.goto(`${BASE}/deck.html${PUBLIC_URL ? `?url=${encodeURIComponent(PUBLIC_URL)}` : ""}`, { waitUntil: "networkidle" });
await deck.waitForSelector("body[data-ready=true]");
await deck.waitForTimeout(1200);
const slides = deck.locator(".slide");
const total = await slides.count();
const notes: string[] = [];
for (let i = 0; i < total; i += 1) {
  await slides.nth(i).screenshot({ path: `${OUT}/deck/slide-${i + 1}.png` });
  notes.push((await slides.nth(i).innerText()).replace(/\n{2,}/g, "\n").trim());
}
await deck.emulateMedia({ media: "print" });
await deck.pdf({ path: `${OUT}/deck/parallax-deck.pdf`, width: "1920px", height: "1080px", printBackground: true });
await browser.close();
server.close();

const pres = new PptxGen();
pres.layout = "LAYOUT_16x9";
pres.title = "Parallax: a content proposal for the Foxit developer program";
pres.author = "Egor";
for (let i = 0; i < total; i += 1) {
  const slide = pres.addSlide();
  slide.addImage({ path: `${OUT}/deck/slide-${i + 1}.png`, x: 0, y: 0, w: 10, h: 5.625 });
  slide.addNotes(notes[i]);
}
await pres.writeFile({ fileName: `${OUT}/deck/parallax-deck.pptx` });
console.log(`exported ${total} slides`);
