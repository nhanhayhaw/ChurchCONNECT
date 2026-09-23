/**
 * Excel and PDF generation.
 *
 * Both writers stream straight to the HTTP response rather than buffering a
 * whole document in memory, so exporting a few thousand members does not spike
 * the server's heap.
 */
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Writable } from 'node:stream';
import { getChurchProfile } from '../../services/settings.service.js';
import { formatLongDate, today } from '../../utils/dates.js';

const NAVY = '#0F2A4A';
const GOLD = '#B8892B';

function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

interface Column {
  header: string;
  key: string;
  width: number;
  get?: (row: any) => unknown;
}

async function buildWorkbook(sheetName: string, columns: Column[], rows: any[]): Promise<ExcelJS.Workbook> {
  const church = await getChurchProfile();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RT AG Connect';
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { orientation: 'landscape', fitToPage: true },
  });

  // Two title rows above the table, merged across the full width.
  const lastCol = String.fromCharCode(64 + columns.length);
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = church.name;
  ws.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF0F2A4A' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = `${sheetName} - generated ${formatLongDate(today())}`;
  ws.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
  ws.getCell('A2').alignment = { horizontal: 'center' };

  ws.addRow([]);

  const headerRow = ws.addRow(columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2A4A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8892B' } } };
  });
  headerRow.height = 22;

  for (const row of rows) {
    ws.addRow(columns.map((c) => (c.get ? c.get(row) : row[c.key] ?? '')));
  }

  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  // Freeze the title block and header so scrolling keeps context.
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };

  return wb;
}

const MEMBER_COLUMNS: Column[] = [
  { header: 'Member ID', key: 'memberCode', width: 14 },
  { header: 'Full Name', key: 'fullName', width: 28 },
  { header: 'Gender', key: 'gender', width: 10, get: (r) => titleCase(r.gender) },
  { header: 'Age', key: 'age', width: 8 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Department', key: 'departmentName', width: 20 },
  { header: 'Group', key: 'groupName', width: 20 },
  { header: 'Status', key: 'membershipStatus', width: 14, get: (r) => titleCase(r.membershipStatus) },
  { header: 'Category', key: 'membershipCategory', width: 16, get: (r) => titleCase(r.membershipCategory) },
  { header: 'Date Joined', key: 'dateJoined', width: 14 },
  { header: 'Last Attendance', key: 'lastAttendanceDate', width: 16 },
];

export function membersToWorkbook(rows: any[]): Promise<ExcelJS.Workbook> {
  return buildWorkbook('Member Register', MEMBER_COLUMNS, rows);
}

export function genericToWorkbook(sheetName: string, columns: Column[], rows: any[]): Promise<ExcelJS.Workbook> {
  return buildWorkbook(sheetName, columns, rows);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

interface PdfTableColumn {
  header: string;
  width: number;
  get: (row: any) => string;
}

/**
 * Draw a paginated table. pdfkit has no table primitive, so column widths,
 * row striping and page breaks are handled here once and reused by every
 * report rather than reimplemented per export.
 */
async function renderPdfTable(
  stream: Writable,
  opts: { title: string; subtitle?: string; columns: PdfTableColumn[]; rows: any[] },
): Promise<void> {
  const church = await getChurchProfile();
  // bufferPages is required for the "Page x of y" footer: without it pdfkit
  // flushes each page as soon as the next begins, and switchToPage() throws.
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
  doc.pipe(stream);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const usable = right - left;
  const totalWeight = opts.columns.reduce((sum, c) => sum + c.width, 0);
  const widths = opts.columns.map((c) => (c.width / totalWeight) * usable);

  let y = 0;

  const drawHeader = (): void => {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(church.name, left, 36);
    doc.fillColor(GOLD).font('Helvetica').fontSize(9).text(church.tagline, left, doc.y + 1);
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(opts.title, left, doc.y + 8);
    if (opts.subtitle) {
      doc.fillColor('#6B7280').font('Helvetica').fontSize(8).text(opts.subtitle, left, doc.y + 1);
    }
    doc.fillColor('#6B7280').fontSize(8).text(`Generated ${formatLongDate(today())}`, left, doc.y + 1);

    y = doc.y + 10;

    // Column header band
    doc.rect(left, y, usable, 18).fill(NAVY);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    let x = left;
    opts.columns.forEach((c, i) => {
      doc.text(c.header, x + 4, y + 5, { width: widths[i]! - 8, ellipsis: true });
      x += widths[i]!;
    });
    y += 18;
  };

  drawHeader();

  doc.font('Helvetica').fontSize(8);
  opts.rows.forEach((row, index) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      drawHeader();
      doc.font('Helvetica').fontSize(8);
    }

    if (index % 2 === 1) doc.rect(left, y, usable, 16).fill('#F4F6F9');

    doc.fillColor('#111827');
    let x = left;
    opts.columns.forEach((c, i) => {
      doc.text(c.get(row) ?? '', x + 4, y + 4, { width: widths[i]! - 8, ellipsis: true, lineBreak: false });
      x += widths[i]!;
    });
    y += 16;
  });

  if (opts.rows.length === 0) {
    doc.fillColor('#6B7280').font('Helvetica-Oblique').fontSize(10).text('No records matched this report.', left, y + 12);
  }

  // Footer on every page. Must run BEFORE doc.end(), while pages are buffered.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc
      .fillColor('#9CA3AF')
      .font('Helvetica')
      .fontSize(7)
      .text(
        `${church.name}  -  Confidential member information  -  Page ${i - range.start + 1} of ${range.count}`,
        left,
        doc.page.height - 30,
        { width: usable, align: 'center' },
      );
  }

  doc.flushPages();
  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
  });
}

const MEMBER_PDF_COLUMNS: PdfTableColumn[] = [
  { header: 'Member ID', width: 12, get: (r) => r.memberCode ?? '' },
  { header: 'Full Name', width: 24, get: (r) => r.fullName ?? '' },
  { header: 'Gender', width: 8, get: (r) => titleCase(r.gender) },
  { header: 'Age', width: 6, get: (r) => (r.age == null ? '' : String(r.age)) },
  { header: 'Phone', width: 14, get: (r) => r.phone ?? '' },
  { header: 'Department', width: 16, get: (r) => r.departmentName ?? '-' },
  { header: 'Status', width: 10, get: (r) => titleCase(r.membershipStatus) },
  { header: 'Joined', width: 12, get: (r) => r.dateJoined ?? '' },
];

export function membersToPdf(rows: any[], stream: Writable): Promise<void> {
  return renderPdfTable(stream, {
    title: 'Member Register',
    subtitle: `${rows.length} member record(s)`,
    columns: MEMBER_PDF_COLUMNS,
    rows,
  });
}

export function genericToPdf(
  stream: Writable,
  opts: { title: string; subtitle?: string; columns: PdfTableColumn[]; rows: any[] },
): Promise<void> {
  return renderPdfTable(stream, opts);
}

export type { PdfTableColumn, Column as ExcelColumn };
