/* Shared by the demo page and the deck: one document page, two views of it. */

export const TRAY_LABEL = {
  annotation: "In a hidden annotation",
  form: "In a hidden form field",
  metadata: "In the document metadata",
};

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Marks each hidden span inside an extracted text, tolerating different line breaks. */
export function highlight(text, spans) {
  let html = escapeHtml(text);
  for (const span of spans) {
    const words = span.split(/\s+/).filter(Boolean).map((w) => escapeRegex(escapeHtml(w)));
    if (words.length === 0) continue;
    const pattern = new RegExp(words.join("\\s+"), "g");
    html = html.replace(pattern, (m) => `<mark>${m}</mark>`);
  }
  return html;
}

export function shorten(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export const count = (list, test) => list.filter(test).length;

/* ------------------------------------------------------------------ sheet */

/**
 * One document page with its hidden text laid back where it sits. In the
 * person view only the render shows; in the model view the page darkens as if
 * under a UV lamp and everything the loader reads but the page hides glows.
 */
export function buildSheet(doc, sheet, { thumb = false } = {}) {
  sheet.replaceChildren();
  const W = doc.page.width;
  const H = doc.page.height;
  sheet.append(
    el("img", {
      src: `img/${doc.id}${thumb ? "-t" : ""}.jpg`,
      alt: `${doc.document}: ${doc.technique}. Rendered by Foxit.`,
      loading: thumb ? "lazy" : "eager",
      decoding: "async",
    }),
  );
  if (thumb) return;

  const tray = [];
  for (const finding of doc.findings) {
    if (finding.kind === "unseen-channel") {
      tray.push([TRAY_LABEL[doc.channel] ?? "Outside the page", finding.text]);
      continue;
    }
    const box = finding.box;
    if (!box) {
      tray.push(["Hidden on the page", finding.text]);
      continue;
    }
    const [x, y, , h] = box;
    if (x > W || x < 0 || y < 0 || y > H) {
      sheet.append(
        el("div", { class: "offpage", style: `bottom:${(Math.min(Math.max(y, 0), H) / H) * 100}%`, text: `Off the page: ${shorten(finding.text, 48)}` }),
      );
      continue;
    }
    const left = (x / W) * 100;
    const bottom = (y / H) * 100;
    // The readable copy sits just under the hidden line, or below the header
    // band when the line hides inside it.
    const calloutTop = bottom > 85 ? 14 : 100 - bottom + 1.8;
    if (h < 3) {
      sheet.append(el("span", { class: "pin", style: `left:${left + 1}%;bottom:${bottom}%;transform:translateY(50%)` }));
      sheet.append(
        el("div", {
          class: "tag",
          style: `left:${left}%;top:${calloutTop + 1.5}%`,
          text: `${h} pt text: ${shorten(finding.text, 110)}`,
        }),
      );
      continue;
    }
    sheet.append(
      el("span", {
        class: "ink",
        style: `left:${left}%;bottom:${bottom}%;font-size:${(h / W) * 100}cqw`,
        text: finding.text,
      }),
      el("div", { class: "tag", style: `left:${left}%;top:${calloutTop}%`, text: shorten(finding.text, 140) }),
    );
  }
  if (tray.length > 0) {
    const box = el("div", { class: "tray" });
    for (const [label, text] of tray) box.append(el("b", { text: label }), el("span", { text: shorten(text, 160) }));
    sheet.append(box);
  }
}

export function wireLamp(root, sheet) {
  for (const button of root.querySelectorAll(".lamp-btn")) {
    button.addEventListener("click", () => {
      sheet.dataset.view = button.dataset.view;
      for (const other of root.querySelectorAll(".lamp-btn")) {
        other.setAttribute("aria-pressed", String(other === button));
      }
    });
  }
}
