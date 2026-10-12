import { browser } from 'wxt/browser';
import type { QueueState } from '@/core/queue/types';
import { getCommentsForItem } from '@/core/storage/comments-db';
import { fileTimestamp } from '@/shared/utils/time';
import { buildCsv } from './csv';

import type { ExportItem } from './rows';

async function collect(state: QueueState): Promise<ExportItem[]> {
  return Promise.all(
    state.items.map(async (item) => ({ item, comments: await getCommentsForItem(item.id) })),
  );
}

/** Chỉ gọi từ trang extension (side panel) vì cần URL.createObjectURL. */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function exportQueue(state: QueueState, format: 'xlsx' | 'csv'): Promise<number> {
  if (!state.items.length) throw new Error('Chưa có dữ liệu để xuất.');
  const items = await collect(state);
  const total = items.reduce((sum, i) => sum + i.comments.length, 0);
  const name = `comments_${fileTimestamp()}`;
  if (format === 'xlsx') {
    // exceljs nặng (~1MB): chỉ tải khi người dùng bấm xuất.
    const { buildWorkbook } = await import('./excel');
    const buffer = await buildWorkbook(items);
    await downloadBlob(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${name}.xlsx`,
    );
  } else {
    await downloadBlob(
      new Blob([buildCsv(items)], { type: 'text/csv;charset=utf-8' }),
      `${name}.csv`,
    );
  }
  return total;
}
