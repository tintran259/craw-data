import ExcelJS from 'exceljs';
import {
  buildCommentRows,
  buildSummaryRows,
  COMMENT_HEADERS,
  CONTENT_COLUMN_INDEX,
  SUMMARY_HEADERS,
  type ExportItem,
} from './rows';

const COMMENT_WIDTHS = [7, 45, 11, 20, 20, 6, 24, 40, 80, 11, 11, 20, 20];
const SUMMARY_WIDTHS = [50, 11, 11, 15, 10, 10, 16, 20, 20, 50];

function styleHeader(sheet: ExcelJS.Worksheet, columnCount: number): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } };
}

export async function buildWorkbook(items: ExportItem[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Social Comment Exporter';
  wb.created = new Date();

  const comments = wb.addWorksheet('Bình luận');
  comments.columns = COMMENT_HEADERS.map((header, i) => ({ header, width: COMMENT_WIDTHS[i] }));
  comments.addRows(buildCommentRows(items));
  styleHeader(comments, COMMENT_HEADERS.length);
  comments.getColumn(CONTENT_COLUMN_INDEX + 1).alignment = { wrapText: true, vertical: 'top' };

  const summary = wb.addWorksheet('Tổng quan');
  summary.columns = SUMMARY_HEADERS.map((header, i) => ({ header, width: SUMMARY_WIDTHS[i] }));
  summary.addRows(buildSummaryRows(items));
  styleHeader(summary, SUMMARY_HEADERS.length);
  summary.getColumn(SUMMARY_HEADERS.length).alignment = { wrapText: true, vertical: 'top' };

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
