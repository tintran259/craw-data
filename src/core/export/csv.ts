import { buildCommentRows, COMMENT_HEADERS, type Cell, type ExportItem } from './rows';

/** BOM giúp Excel nhận đúng UTF-8 (tiếng Việt, emoji). */
const BOM = '﻿';

function escapeCell(value: Cell): string {
  if (value === null) return '';
  let text = String(value);
  // Chống CSV injection: ô bắt đầu bằng ký tự công thức bị Excel thực thi.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(items: ExportItem[]): string {
  const lines = [COMMENT_HEADERS as readonly Cell[], ...buildCommentRows(items)].map((row) =>
    row.map(escapeCell).join(','),
  );
  return BOM + lines.join('\r\n') + '\r\n';
}
