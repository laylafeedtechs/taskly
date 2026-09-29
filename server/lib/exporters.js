// Report exporters without external dependencies: CSV, Excel (SpreadsheetML 2003)
// and a minimal PDF writer using the built-in Helvetica font.

const csvCell = value => {
  let s = value === null || value === undefined ? '' : String(value);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function toCsv(headers, rows) {
  return '﻿' + [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n');
}

const xmlEscape = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export function toExcelXml(sheets) {
  const cell = v => {
    const isNum = typeof v === 'number' && Number.isFinite(v);
    return `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${xmlEscape(v)}</Data></Cell>`;
  };
  const body = sheets.map(({ name, headers, rows }) => `
  <Worksheet ss:Name="${xmlEscape(name).slice(0, 31)}"><Table>
   <Row>${headers.map(h => `<Cell ss:StyleID="h"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join('')}</Row>
   ${rows.map(r => `<Row>${r.map(cell).join('')}</Row>`).join('\n   ')}
  </Table></Worksheet>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>${body}
</Workbook>`;
}

// --- PDF -------------------------------------------------------------------

// WinAnsi covers Portuguese accents; anything else is replaced.
function pdfText(s) {
  const buf = [];
  for (const ch of String(s ?? '')) {
    const code = ch.charCodeAt(0);
    const mapped = code < 256 ? code : ({ '—': 0x97, '–': 0x96, '…': 0x85, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '•': 0x95, '≠': 0x3d }[ch] ?? 0x3f);
    if (mapped === 0x28 || mapped === 0x29 || mapped === 0x5c) buf.push(0x5c);
    buf.push(mapped);
  }
  return Buffer.from(buf).toString('latin1');
}

const truncate = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function toPdf({ title, subtitle, metrics = [], table }) {
  const W = 842, H = 595, M = 36; // A4 landscape
  const pages = [];
  let ops = [];
  let y = H - M;
  const text = (x, yy, size, s, bold = false, gray = 0) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${gray} g ${x} ${yy} Td (${pdfText(s)}) Tj ET`);
  const newPage = () => { if (ops.length) pages.push(ops.join('\n')); ops = []; y = H - M; };

  text(M, y, 18, title, true); y -= 20;
  if (subtitle) { text(M, y, 9, subtitle, false, 0.4); y -= 22; }
  metrics.forEach((m, i) => {
    const x = M + (i % 4) * 190;
    if (i % 4 === 0 && i) y -= 40;
    text(x, y, 8, m.label.toUpperCase(), false, 0.45);
    text(x, y - 16, 14, m.value, true);
  });
  if (metrics.length) y -= 44;

  const colW = table.widths || table.headers.map(() => (W - 2 * M) / table.headers.length);
  const drawHeader = () => {
    ops.push(`0.93 g ${M} ${y - 4} ${W - 2 * M} 16 re f`);
    let x = M + 4;
    table.headers.forEach((h, i) => { text(x, y, 8, h, true); x += colW[i]; });
    y -= 18;
  };
  drawHeader();
  table.rows.forEach(row => {
    if (y < M + 20) { newPage(); drawHeader(); }
    let x = M + 4;
    row.forEach((c, i) => { text(x, y, 8, truncate(c, Math.floor(colW[i] / 4.6))); x += colW[i]; });
    ops.push(`0.9 G 0.5 w ${M} ${y - 5} m ${W - M} ${y - 5} l S`);
    y -= 15;
  });
  newPage();

  // Assemble objects: catalog, pages, fonts, then page/content pairs.
  const objects = [];
  const add = s => { objects.push(s); return objects.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((content, i) => {
    const footer = `BT /F1 7 Tf 0.5 g ${W - M - 60} ${M / 2} Td (${pdfText(`Página ${i + 1} de ${pages.length}`)}) Tj ET`;
    const stream = `${content}\n${footer}`;
    const c = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
