/**
 * Minimal RFC 4180 CSV: quoted fields, embedded separators, quotes and line breaks, CRLF or LF.
 * Spreadsheets in Spanish locales save with ";" so the separator is detected from the header line.
 */

/** Rows of the file; each row knows the line it starts on (for error reports). */
export function parseCsv(input: string): { line: number; cells: string[] }[] {
  const text = input.replace(/^\uFEFF/, '');
  const sep = detectSeparator(text);
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      if (cells.some((c) => c !== '')) rows.push({ line: rowLine, cells });
      cells = [];
      cell = '';
      line++;
      rowLine = line;
    } else cell += ch;
  }
  cells.push(cell);
  if (cells.some((c) => c !== '')) rows.push({ line: rowLine, cells });
  return rows;
}

function detectSeparator(text: string): ',' | ';' | '\t' {
  const first = text.slice(0, text.search(/\r?\n|$/));
  const count = (c: string) => first.split(c).length - 1;
  const [best] = ([',', ';', '\t'] as const).map((c) => [c, count(c)] as const).sort((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : ',';
}

const needsQuotes = /[",\r\n]/;
const cellOf = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return needsQuotes.test(s) || /^\s|\s$/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** A CSV document with a BOM so spreadsheet apps read it as UTF-8. */
export function toCsv(header: readonly string[], rows: unknown[][]): string {
  return '\uFEFF' + [header, ...rows].map((r) => r.map(cellOf).join(',')).join('\r\n') + '\r\n';
}
