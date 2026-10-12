import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { CommentRecord } from '@/adapters/types';
import type { QueueItem } from '@/core/queue/types';
import { buildCsv } from './csv';
import { buildWorkbook } from './excel';
import { orderThreaded, type ExportItem } from './rows';

const item: QueueItem = {
  id: 'i1',
  inputUrl: 'https://www.facebook.com/page/posts/1',
  normalizedUrl: 'https://www.facebook.com/page/posts/1',
  platform: 'facebook',
  status: 'done',
  rootCount: 2,
  replyCount: 2,
  expectedTotal: 4,
  error: null,
  retryOnResume: false,
  startedAt: '2026-10-12T01:00:00.000Z',
  finishedAt: '2026-10-12T01:05:00.000Z',
};

const c = (
  commentId: string,
  parentId: string | null,
  createdAt: string | null,
  content = `nội dung ${commentId}`,
): CommentRecord => ({
  postUrl: item.inputUrl,
  platform: 'facebook',
  commentId,
  parentId,
  depth: parentId ? (parentId === 'r1' ? 2 : 1) : 0,
  authorName: 'Nguyễn Văn Á',
  authorId: '1',
  authorProfileUrl: 'https://www.facebook.com/a',
  content,
  attachmentUrls: [],
  reactionCount: 3,
  replyCount: null,
  createdAt,
  crawledAt: '2026-10-12T02:00:00.000Z',
});

// Thứ tự thu thập lộn xộn: reply đến trước comment cha.
const comments = [
  c('r2', 'a', '2026-10-12T00:10:00.000Z'),
  c('b', null, '2026-10-12T00:05:00.000Z', '=1+1'),
  c('a', null, '2026-10-12T00:01:00.000Z', 'Xin chào 😀\ndòng 2, có "ngoặc"'),
  c('r1', 'a', '2026-10-12T00:02:00.000Z'),
  c('rr', 'r1', '2026-10-12T00:03:00.000Z'),
  c('orphan', 'missing', null),
];
const items: ExportItem[] = [{ item, comments }];

describe('orderThreaded', () => {
  it('reply nằm ngay dưới comment cha, theo thời gian; reply mồ côi ở cuối', () => {
    expect(orderThreaded(comments).map((x) => x.commentId)).toEqual([
      'a',
      'r1',
      'rr',
      'r2',
      'b',
      'orphan',
    ]);
  });
});

describe('buildWorkbook', () => {
  it('tạo 2 sheet đúng cột, định dạng và nội dung', async () => {
    const buffer = await buildWorkbook(items);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    const sheet = wb.getWorksheet('Bình luận')!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'STT',
      'Link bài viết',
      'Nền tảng',
      'ID bình luận',
      'ID bình luận cha',
      'Cấp',
      'Tên người bình luận',
      'Link profile',
      'Nội dung',
      'Số reaction',
      'Số phản hồi',
      'Thời gian bình luận',
      'Thời gian thu thập',
    ]);
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.getColumn(9).alignment?.wrapText).toBe(true);
    expect(sheet.rowCount).toBe(7);

    const ids = [2, 3, 4, 5, 6, 7].map((r) => sheet.getRow(r).getCell(4).value);
    expect(ids).toEqual(['a', 'r1', 'rr', 'r2', 'b', 'orphan']);
    expect(sheet.getRow(2).getCell(9).value).toBe('Xin chào 😀\ndòng 2, có "ngoặc"');
    expect(sheet.getRow(3).getCell(9).value).toBe('↳ nội dung r1');
    expect(sheet.getRow(4).getCell(9).value).toBe('    ↳ nội dung rr');
    // Nội dung giống công thức vẫn là chuỗi, không bị thực thi.
    expect(sheet.getRow(6).getCell(9).value).toBe('=1+1');
    expect(sheet.getRow(2).getCell(12).value).toMatch(/^\d{2}\/\d{2}\/2026 \d{2}:\d{2}:\d{2}$/);
    expect(sheet.getRow(2).getCell(7).value).toBe('Nguyễn Văn Á');

    const summary = wb.getWorksheet('Tổng quan')!;
    expect(summary.getRow(2).values).toEqual(
      expect.arrayContaining([item.inputUrl, 'Facebook', 'Xong', 2, 4, 6]),
    );
  });
});

describe('buildCsv', () => {
  it('có BOM, escape đúng, chống CSV injection', () => {
    const csv = buildCsv(items);
    expect(csv.startsWith('﻿STT,Link bài viết,')).toBe(true);
    expect(csv).toContain('"Xin chào 😀\ndòng 2, có ""ngoặc"""');
    expect(csv).toContain(",'=1+1,");
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(7); // header + 6 dòng; xuống dòng trong ô là \n nên không tách dòng
  });
});
