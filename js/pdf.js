// PDF in the browser (jsPDF). Mirrors the paper form "<ORG> MONTHLY MILEAGE EXPENSE REPORT":
//   EMPLOYEE NAME / rows of DATE, FROM, TO, MILES (plus a BUSINESS PURPOSE column, which the
//   paper form lacks but the trip log requires) / TOTAL MILES x RATE PER MILE /
//   TOTAL MILEAGE EXPENSE / EMPLOYEE SIGNATURE / APPROVED BY, DATE PAID, METHOD OF PAYMENT.
// The paper form has 15 trip lines; blank dotted lines pad the page up to 15.
import { fmtDate, fmtDateTime, money, miles as fmtMiles, rateStr, safeFile, NOTICE, PAYMENT_METHODS } from './util.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const MIN_LINES = 15;

function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSPDF_URL;
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error('Could not load the PDF library. Check your connection.'));
    document.head.appendChild(s);
  });
}

// x = left edge (pt), w = text width; MILES is right-aligned at its right edge.
const COLS = [
  { k: 'date', h: 'DATE', x: 40, w: 58 },
  { k: 'from', h: 'FROM', x: 104, w: 118 },
  { k: 'to', h: 'TO', x: 228, w: 118 },
  { k: 'purpose', h: 'BUSINESS PURPOSE', x: 352, w: 128 },
  { k: 'miles', h: 'MILES', x: 486, w: 86, right: true },
];

export async function reportPdf(m, isDraft) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_BOTTOM = 735;
  const dots = () => doc.setLineDashPattern([1, 2.2], 0);
  const solid = () => doc.setLineDashPattern([], 0);
  let y;

  const title = () => {
    const t = `${(m.orgName || '').toUpperCase()} MONTHLY MILEAGE EXPENSE REPORT`.trim();
    let size = 15;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    while (doc.getTextWidth(t) > 532 && size > 9) { size -= 0.5; doc.setFontSize(size); }
    doc.text(t, 306, 52, { align: 'center' });
  };
  const tableHead = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    COLS.forEach((c) => doc.text(c.h, c.right ? c.x + c.w : c.x, y, c.right ? { align: 'right' } : undefined));
    doc.setDrawColor(60); solid(); doc.line(40, y + 5, 572, y + 5);
    y += 22; doc.setFont('helvetica', 'normal');
  };

  title();
  y = 88;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('EMPLOYEE NAME:', 40, y);
  doc.setFont('helvetica', 'normal'); doc.text(m.employee || '', 142, y);
  doc.setFont('helvetica', 'bold'); doc.text('MONTH:', 400, y);
  doc.setFont('helvetica', 'normal'); doc.text(m.monthLabel.toUpperCase(), 446, y);
  y += 10;
  if (isDraft) {
    doc.setTextColor(170, 0, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('DRAFT - NOT SIGNED', 40, y + 8); doc.setTextColor(0); y += 14;
  }
  y += 22;
  tableHead();

  // Trip lines (padded with blank dotted lines to at least 15, like the paper form).
  const rows = [...m.rows];
  while (rows.length < MIN_LINES) rows.push(null);
  doc.setFontSize(9.5);
  for (const r of rows) {
    const cells = r && {
      date: fmtDate(r.date), from: r.from, to: r.to, purpose: r.purpose, miles: fmtMiles(r.miles),
    };
    const lines = COLS.map((c) => (cells ? (c.right ? [cells[c.k]] : doc.splitTextToSize(cells[c.k], c.w)) : ['']));
    const h = Math.max(24, Math.max(...lines.map((l) => l.length)) * 11 + 10);
    if (y + h > PAGE_BOTTOM) { doc.addPage(); y = 60; tableHead(); doc.setFontSize(9.5); }
    if (cells) COLS.forEach((c, i) => doc.text(lines[i], c.right ? c.x + c.w : c.x, y, c.right ? { align: 'right' } : undefined));
    doc.setDrawColor(130); dots(); doc.line(40, y + h - 14, 572, y + h - 14); solid();
    y += h;
  }

  // Totals + signature block, kept together on one page.
  const rateLines = m.breakdown.length > 1 ? m.breakdown.length : 1;
  const needed = 160 + (rateLines - 1) * 16;
  if (y + needed > PAGE_BOTTOM) { doc.addPage(); y = 60; }
  y += 14; doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  if (m.breakdown.length <= 1) {
    const rate = m.breakdown.length ? rateStr(m.breakdown[0].rate) : '';
    doc.text('TOTAL MILES:', 40, y);
    doc.setFont('helvetica', 'normal'); doc.text(fmtMiles(m.totalMiles), 128, y);
    doc.setDrawColor(0); dots(); doc.line(126, y + 2, 270, y + 2); solid();
    doc.setFont('helvetica', 'bold'); doc.text('X', 300, y);
    doc.text(`${rate} PER MILE`, 325, y);
    y += 26;
  } else {
    doc.text('TOTAL MILES:', 40, y);
    doc.setFont('helvetica', 'normal'); doc.text(fmtMiles(m.totalMiles), 128, y);
    doc.setDrawColor(0); dots(); doc.line(126, y + 2, 200, y + 2); solid();
    for (const b of m.breakdown) {
      doc.setFont('helvetica', 'bold');
      doc.text(`${fmtMiles(b.miles)} MILES X ${rateStr(b.rate)} PER MILE`, 230, y);
      doc.setFont('helvetica', 'normal'); doc.text(money(b.amount), 572, y, { align: 'right' });
      y += 16;
    }
    y += 10;
  }

  const field = (label, value, x, lineFrom, lineTo, yy) => {
    doc.setFont('helvetica', 'bold'); doc.text(label, x, yy);
    doc.setFont('helvetica', 'normal'); if (value) doc.text(value, lineFrom + 2, yy);
    doc.setDrawColor(0); dots(); doc.line(lineFrom, yy + 2, lineTo, yy + 2); solid();
  };
  field('TOTAL MILEAGE EXPENSE:', money(m.total), 40, 198, 348, y);
  y += 32;

  doc.setFont('helvetica', 'bold'); doc.text('EMPLOYEE SIGNATURE:', 40, y);
  if (m.signedName) {
    doc.setFont('times', 'italic'); doc.setFontSize(16); doc.text(m.signedName, 186, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Signed electronically ${fmtDateTime(m.signedAt)}`, 186, y + 12);
    doc.setFontSize(11);
  }
  doc.setDrawColor(0); dots(); doc.line(184, y + 2, 400, y + 2); solid();
  y += 40;

  const method = (PAYMENT_METHODS.find((p) => p[0] === m.paymentMethod) || [, ''])[1];
  field('APPROVED BY:', m.approvedBy, 40, 128, 268, y);
  field('DATE PAID:', m.paidDate ? fmtDate(m.paidDate) : '', 282, 352, 442, y);
  y += 28;
  field('METHOD OF PAYMENT:', method, 40, 184, 330, y);
  if (m.approvedAt) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Approved ${fmtDateTime(m.approvedAt)}`, 130, y - 28 + 12);
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text(`${NOTICE}${m.hash ? '  Record ID ' + m.hash.slice(0, 16) : ''}`, 40, 768);
    doc.text(`Page ${i} of ${n}`, 572, 768, { align: 'right' });
    doc.setTextColor(0);
  }
  doc.save(`mileage-${safeFile(m.employee)}-${m.month.slice(0, 7)}.pdf`);
}
