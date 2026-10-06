import { buildSheet, count, el } from "./sheet.js";

const data = await fetch("data/results.json").then((r) => r.json());
const docs = data.documents;
const byId = Object.fromEntries(docs.map((d) => [d.id, d]));

for (const sheet of document.querySelectorAll(".sheet[data-doc]")) buildSheet(byId[sheet.dataset.doc], sheet);

const attacks = docs.filter((d) => d.kind === "attack");
const controls = docs.filter((d) => d.kind === "control");
const onPage = attacks.filter((d) => d.channel === "page");
const pypdf = count(onPage, (d) => d.score.deliveredBy.pypdf.includes("page text"));
const pdfjs = count(onPage, (d) => d.score.deliveredBy.pdfjs.includes("page text"));
const detected = count(attacks, (d) => d.score.detected);
const leaks = count(attacks, (d) => d.score.leaksIntoCleanOutput);
const falseAlarms = count(controls, (d) => d.score.falsePositives > 0);

document.getElementById("s2-stat").textContent =
  `pypdf, the library behind LangChain’s PyPDFLoader, extracted ${pypdf === onPage.length ? `all ${onPage.length}` : `${pypdf} of ${onPage.length}`} instructions hidden on the page.`;

document.getElementById("s4-title").textContent =
  detected === attacks.length && falseAlarms === 0
    ? `All ${attacks.length} hidden instructions flagged, no false alarms`
    : `${detected} of ${attacks.length} hidden instructions flagged`;

const bars = document.getElementById("bars");
const row = (label, value, total, good = false) =>
  el("div", { class: `bar-row${good ? " good" : ""}` }, [
    el("div", { class: "label" }, [el("span", { text: label }), el("span", { text: `${value} of ${total}` })]),
    el("div", { class: "bar-track" }, [el("div", { class: "bar-fill", style: `width:${(value / total) * 100}%` })]),
  ]);
bars.append(
  row("Hidden on the page, extracted by pypdf", pypdf, onPage.length),
  row("Hidden on the page, extracted by pdf.js", pdfjs, onPage.length),
  row("Hidden instructions flagged by Parallax", detected, attacks.length, true),
  row("Hidden instructions left in Parallax output", leaks, attacks.length),
  row("False alarms on clean controls", falseAlarms, controls.length),
);

const grid = document.getElementById("mini-grid");
for (const doc of docs) {
  const status =
    doc.kind === "attack" ? (doc.score.detected ? "flagged" : "wrong") : doc.score.falsePositives === 0 ? "clean" : "wrong";
  grid.append(el("div", { class: "mini" }, [el("img", { src: `img/${doc.id}-t.jpg`, alt: "" }), el("span", { class: `badge ${status}` })]));
}
grid.append(
  el("div", { class: "legend" }, [
    el("span", {}, [el("i", { style: "background:var(--uv-mid)" }), "Hidden text flagged"]),
    el("span", {}, [el("i", { style: "background:var(--clean)" }), "Control, nothing flagged"]),
  ]),
);

const run = new Date(data.summary.runAt);
document.getElementById("s4-note").textContent =
  `${docs.length} documents: ${attacks.length} attacks, each hiding text a different way, and ${controls.length} controls built to cause false alarms. Run against Foxit PDF Services, ${run.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`;

const url = new URLSearchParams(location.search).get("url");
if (url) document.getElementById("s6-url").textContent = url.replace(/^https?:\/\//, "");

document.body.dataset.ready = "true";
