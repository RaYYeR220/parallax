import { TRAY_LABEL, el, escapeHtml, highlight, count, buildSheet, wireLamp } from "./sheet.js";

const HERO_ID = "A01";

const CHANNEL_LABEL = {
  "page text": "Page text",
  annotation: "Annotation",
  form: "Form value",
  metadata: "Metadata",
};

const data = await fetch("data/results.json").then((r) => r.json());
const docs = data.documents;
const byId = Object.fromEntries(docs.map((d) => [d.id, d]));

/* ------------------------------------------------------------------- hero */

const attacks = docs.filter((d) => d.kind === "attack");
const controls = docs.filter((d) => d.kind === "control");
const onPage = attacks.filter((d) => d.channel === "page");
const pypdfPage = count(onPage, (d) => d.score.deliveredBy.pypdf.includes("page text"));
const pdfjsPage = count(onPage, (d) => d.score.deliveredBy.pdfjs.includes("page text"));
const detected = count(attacks, (d) => d.score.detected);
const leaks = count(attacks, (d) => d.score.leaksIntoCleanOutput);
const falseAlarms = count(controls, (d) => d.score.falsePositives > 0);

{
  const caught = detected === attacks.length ? `all ${attacks.length}` : `${detected} of ${attacks.length}`;
  const quiet =
    falseAlarms === 0
      ? `and raised no alarm on any of the ${controls.length} clean controls`
      : `and raised ${falseAlarms} false alarm${falseAlarms === 1 ? "" : "s"} on ${controls.length} controls`;
  document.getElementById("hero-finding").innerHTML =
    `In a ${docs.length}-document test, <strong>pypdf, the library behind LangChain’s PyPDFLoader, extracted ${pypdfPage === onPage.length ? `all ${onPage.length}` : `${pypdfPage} of the ${onPage.length}`} instructions hidden on the page</strong> and handed them on as ordinary text. ` +
    `Parallax flagged ${caught} hidden instructions, left ${leaks === 0 ? "none" : leaks} in what the agent receives, ${quiet}.`;

  const hero = byId[HERO_ID];
  const figure = document.getElementById("hero-specimen");
  const sheet = figure.querySelector(".sheet");
  buildSheet(hero, sheet);
  wireLamp(figure, sheet);
  document.getElementById("hero-caption").textContent =
    `${hero.document}, rendered by Foxit. Hidden with ${hero.technique.charAt(0).toLowerCase()}${hero.technique.slice(1)}. ${hero.note}`;
}

/* ------------------------------------------------------------------- grid */

const grid = document.getElementById("grid");
const detail = document.getElementById("detail");
let open = null;

function outcome(doc) {
  if (doc.kind === "attack") {
    return doc.score.detected ? ["flagged", "Hidden text found"] : ["wrong", "Missed"];
  }
  return doc.score.falsePositives === 0 ? ["clean", "Clean, nothing flagged"] : ["wrong", "False alarm"];
}

for (const doc of docs) {
  const [cls, label] = outcome(doc);
  const thumb = el("div", { class: "thumb" });
  buildSheet(doc, thumb, { thumb: true });
  const button = el("button", { class: "doc", type: "button", "aria-expanded": "false", "aria-controls": "detail" }, [
    thumb,
    el("h3", { text: doc.technique }),
    el("p", { class: "kind", text: doc.kind === "control" ? `${doc.document}, control` : doc.document }),
    el("p", { class: `outcome ${cls}` }, [el("span", { class: "dot", "aria-hidden": "true" }), label]),
  ]);
  button.addEventListener("click", () => showDetail(doc, button));
  grid.append(button);
}

function showDetail(doc, button) {
  if (open === doc.id) {
    closeDetail();
    return;
  }
  for (const b of grid.querySelectorAll(".doc")) b.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-expanded", "true");
  open = doc.id;

  const figure = el("figure", { class: "specimen" });
  const lamp = el("div", { class: "lamp", role: "group", "aria-label": "Choose a view of the document" }, [
    el("button", { type: "button", class: "lamp-btn", "data-view": "person", "aria-pressed": "false", text: "What a person sees" }),
    el("button", { type: "button", class: "lamp-btn", "data-view": "model", "aria-pressed": "true", text: "What the model reads" }),
  ]);
  const sheet = el("div", { class: "sheet", "data-view": "model" });
  figure.append(lamp, sheet);
  buildSheet(doc, sheet);
  wireLamp(figure, sheet);

  const spans = doc.findings.map((f) => f.text);
  const findings = doc.findings.length
    ? el(
        "ul",
        { class: "findings" },
        doc.findings.map((f) =>
          el("li", {}, [
            el("q", { text: f.text }),
            el("p", { class: "why", text: f.reason }),
            el("ul", { class: "evidence" }, f.evidence.map((e) => el("li", { text: e }))),
            el("p", { class: "readers", text: `Extracted by ${f.readBy.join(", ")}` }),
          ]),
        ),
      )
    : el("p", {
        class: "none",
        text:
          doc.kind === "control"
            ? "Nothing flagged. Everything the loaders extract is also on the rendered page."
            : "Parallax did not flag this document.",
      });

  const channelText = doc.channel && doc.channel !== "page" && doc.payload ? `\n\n[${TRAY_LABEL[doc.channel]}]\n${doc.payload}` : "";
  const readerText = (doc.views.pypdf || "").trim();
  const model = el("pre", {
    html: readerText || channelText ? highlight(readerText + channelText, spans) : `<span class="empty">pypdf extracted nothing: the page is an image.</span>`,
  });
  const clean = el("pre", {
    html: doc.cleanText ? escapeHtml(doc.cleanText) : `<span class="empty">Nothing.</span>`,
  });

  const info = el("div", {}, [
    el("h3", { text: doc.technique }),
    el("p", { class: "note", text: `${doc.document}. ${doc.note}` }),
    findings,
    el("div", { class: "views" }, [
      el("div", {}, [el("h4", { text: "What pypdf hands the model" }), model]),
      el("div", {}, [el("h4", { text: "What Parallax hands the agent" }), clean]),
    ]),
    el("p", { class: "detail-actions" }, [
      el("a", { href: `data/pdf/${doc.file}`, download: doc.file, text: "Download this PDF" }),
      el("button", { type: "button", class: "close", text: "Close" }),
    ]),
  ]);
  info.querySelector(".close").addEventListener("click", () => {
    closeDetail();
    button.focus();
  });

  detail.replaceChildren(figure, info);
  detail.hidden = false;
  detail.setAttribute("aria-label", doc.technique);
  detail.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function closeDetail() {
  open = null;
  detail.hidden = true;
  for (const b of grid.querySelectorAll(".doc")) b.setAttribute("aria-expanded", "false");
}

/* ---------------------------------------------------------------- results */

{
  const channels = attacks.filter((d) => d.channel !== "page");
  const exposed = count(channels, (d) => d.score.deliveredBy.pypdf.length > 0);
  document.getElementById("results-lede").textContent =
    `pypdf extracted ${pypdfPage === onPage.length ? `all ${onPage.length}` : `${pypdfPage} of the ${onPage.length}`} instructions hidden on the page and pdf.js ${pdfjsPage}; ` +
    `both also expose ${exposed === channels.length ? `all ${channels.length}` : `${exposed} of the ${channels.length}`} carried in annotations, form values and metadata. ` +
    `Parallax flagged ${detected} of ${attacks.length}, left ${leaks === 0 ? "none" : leaks} in its output, and raised ${falseAlarms === 0 ? "no" : falseAlarms} false alarm${falseAlarms === 1 ? "" : "s"} on the ${controls.length} controls.`;

  const body = document.querySelector("#results-table tbody");
  const extracted = (list) => (list.length ? list.map((c) => CHANNEL_LABEL[c] ?? c).join(", ") : "No");
  for (const doc of docs) {
    const row = el("tr", { class: doc.kind });
    if (doc.kind === "attack") {
      row.append(
        el("td", { text: doc.document }),
        el("td", { text: doc.technique }),
        el("td", { class: doc.score.deliveredBy.pypdf.length ? "yes" : "", text: extracted(doc.score.deliveredBy.pypdf) }),
        el("td", { class: doc.score.deliveredBy.pdfjs.length ? "yes" : "", text: extracted(doc.score.deliveredBy.pdfjs) }),
        el("td", { class: doc.score.detected ? "caught" : "bad", text: doc.score.detected ? "Flagged" : "Missed" }),
        el("td", { class: doc.score.leaksIntoCleanOutput ? "bad" : "ok", text: doc.score.leaksIntoCleanOutput ? "Yes" : "No" }),
      );
    } else {
      row.append(
        el("td", { text: `${doc.document} (control)` }),
        el("td", { text: doc.technique }),
        el("td", { text: "Nothing hidden" }),
        el("td", { text: "Nothing hidden" }),
        el("td", { class: doc.score.falsePositives ? "bad" : "ok", text: doc.score.falsePositives ? "False alarm" : "Nothing flagged" }),
        el("td", { text: doc.cleanText ? "Full page text" : "Empty" }),
      );
    }
    body.append(row);
  }

  const run = new Date(data.summary.runAt);
  document.getElementById("note-run").textContent =
    `Every result on this page comes from a run against Foxit PDF Services on ${run.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. ` +
    "The results are stored so that clicking around spends no credits; the repository reruns the whole test with one command.";
}
