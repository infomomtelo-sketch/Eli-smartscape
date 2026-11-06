// PDF in the browser (jsPDF), laid out like the paper mileage form plus a purpose column:
// employee, month, trip rows, total miles, rate(s), total expense, employee signature,
// approved by, date paid, method.
import { fmtDate, fmtDateTime, money, miles as fmtMiles, rateStr, safeFile, NOTICE, PAYMENT_METHODS } from './util.js';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

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

// Columns: x = left edge (pt), w = text width, right = right-aligned numeric column
const COLS = [
  { k: 'date', h: 'Date', x: 40, w: 48 },
  { k: 'from', h: 'From', x: 92, w: 100 },
  { k: 'to', h: 'To', x: 196, w: 100 },
  { k: 'purpose', h: 'Business purpose', x: 300, w: 120 },
  { k: 'miles', h: 'Miles', x: 424, w: 40, right: true },
  { k: 'rate', h: 'Rate', x: 468, w: 42, right: true },
  { k: 'amount', h: 'Amount', x: 514, w: 58, right: true },
];

export async function reportPdf(m, isDraft) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_BOTTOM = 730;
  let y = 48;

  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('MILEAGE REIMBURSEMENT REPORT', 40, y);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    if (m.orgName) doc.text(m.orgName, 572, y, { align: 'right' });
  };
  const tableHead = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    COLS.forEach((c) => doc.text(c.h, c.right ? c.x + c.w : c.x, y, c.right ? { align: 'right' } : undefined));
    doc.setDrawColor(120); doc.line(40, y + 4, 572, y + 4);
    y += 16; doc.setFont('helvetica', 'normal');
  };

  header(); y += 24;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold'); doc.text('Employee:', 40, y);
  doc.setFont('helvetica', 'normal'); doc.text(m.employee || '', 100, y);
  doc.setFont('helvetica', 'bold'); doc.text('Month:', 340, y);
  doc.setFont('helvetica', 'normal'); doc.text(m.monthLabel, 380, y);
  y += 18;
  if (isDraft) {
    doc.setTextColor(170, 0, 0); doc.setFont('helvetica', 'bold');
    doc.text('DRAFT - not signed', 40, y); doc.setTextColor(0); y += 16;
  }
  y += 4;
  tableHead();

  doc.setFontSize(8.5);
  for (const r of m.rows) {
    const cells = {
      date: fmtDate(r.date), from: r.from, to: r.to, purpose: r.purpose,
      miles: fmtMiles(r.miles), rate: rateStr(r.rate), amount: money(r.amount),
    };
    const lines = COLS.map((c) => (c.right ? [cells[c.k]] : doc.splitTextToSize(cells[c.k], c.w)));
    const h = Math.max(...lines.map((l) => l.length)) * 11 + 4;
    if (y + h > PAGE_BOTTOM) { doc.addPage(); y = 48; tableHead(); doc.setFontSize(8.5); }
    COLS.forEach((c, i) => doc.text(lines[i], c.right ? c.x + c.w : c.x, y, c.right ? { align: 'right' } : undefined));
    y += h;
    doc.setDrawColor(220); doc.line(40, y - 8, 572, y - 8);
  }

  // Totals + signatures; keep together on one page.
  const needed = 40 + m.breakdown.length * 13 + 170;
  if (y + needed > PAGE_BOTTOM) { doc.addPage(); y = 48; }
  y += 6; doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Total miles:', 330, y); doc.text(fmtMiles(m.totalMiles), 572, y, { align: 'right' }); y += 15;
  doc.setFont('helvetica', 'normal');
  if (m.breakdown.length === 1) {
    doc.text('Rate per mile:', 330, y); doc.text(rateStr(m.breakdown[0].rate), 572, y, { align: 'right' }); y += 15;
  } else {
    for (const b of m.breakdown) {
      doc.text(`${fmtMiles(b.miles)} mi at ${rateStr(b.rate)}`, 330, y);
      doc.text(money(b.amount), 572, y, { align: 'right' }); y += 13;
    }
    y += 2;
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('Total expense:', 330, y); doc.text(money(m.total), 572, y, { align: 'right' }); y += 34;

  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal'); doc.text('Employee signature:', 40, y);
  if (m.signedName) {
    doc.setFont('times', 'italic'); doc.setFontSize(15); doc.text(m.signedName, 150, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(`Signed electronically ${fmtDateTime(m.signedAt)}`, 150, y + 11);
  }
  doc.setDrawColor(0); doc.line(148, y + 2, 400, y + 2);
  y += 40; doc.setFontSize(10.5);
  const method = (PAYMENT_METHODS.find((p) => p[0] === m.paymentMethod) || [, ''])[1];
  doc.text('Approved by:', 40, y); doc.text(m.approvedBy || '', 120, y); doc.line(118, y + 2, 330, y + 2);
  doc.text('Date:', 345, y); doc.text(m.approvedAt ? fmtDate(m.approvedAt) : '', 375, y); doc.line(372, y + 2, 460, y + 2);
  y += 28;
  doc.text('Date paid:', 40, y); doc.text(m.paidDate ? fmtDate(m.paidDate) : '', 120, y); doc.line(118, y + 2, 250, y + 2);
  doc.text('Method:', 270, y); doc.text(method, 322, y); doc.line(320, y + 2, 460, y + 2);

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text(`${NOTICE}${m.hash ? '  Record ID ' + m.hash.slice(0, 16) : ''}`, 40, 765);
    doc.text(`Page ${i} of ${n}`, 572, 765, { align: 'right' });
    doc.setTextColor(0);
  }
  doc.save(`mileage-${safeFile(m.employee)}-${m.month.slice(0, 7)}.pdf`);
}
