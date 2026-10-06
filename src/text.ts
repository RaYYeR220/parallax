/** Tokenising and comparison shared by the detector and the benchmark. */

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Equal, or one edit apart once a word is long enough for OCR to have misread it. */
export function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  return editDistance(a, b) <= 1;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

/**
 * The share of a phrase's distinctive words found in a text. Short words are
 * left out because "the" and "to" are everywhere and prove nothing.
 */
export function coverage(phrase: string, text: string): number {
  const wanted = tokens(phrase).filter((t) => t.length > 3);
  if (wanted.length === 0) return 0;
  const have = new Set(tokens(text));
  return wanted.filter((t) => have.has(t)).length / wanted.length;
}

/** A payload counts as delivered when most of its distinctive words reach the reader. */
export const DELIVERED = 0.6;
