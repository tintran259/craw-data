import { getPlatformLabel } from '@/adapters/registry';
import type { CommentRecord } from '@/adapters/types';
import { ITEM_STATUS_LABEL, type QueueItem } from '@/core/queue/types';
import { formatDisplayTime } from '@/shared/utils/time';

export interface ExportItem {
  item: QueueItem;
  comments: CommentRecord[];
}

export type Cell = string | number | null;

export const COMMENT_HEADERS = [
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
] as const;

export const CONTENT_COLUMN_INDEX = COMMENT_HEADERS.indexOf('Nội dung');

export const SUMMARY_HEADERS = [
  'Link bài viết',
  'Nền tảng',
  'Trạng thái',
  'Số comment gốc',
  'Số reply',
  'Tổng',
  'Số bình luận nền tảng hiển thị',
  'Thời gian bắt đầu',
  'Thời gian kết thúc',
  'Ghi chú lỗi',
] as const;

/** Giới hạn độ dài ô của Excel. */
const MAX_CELL_CHARS = 32_767;

function byTime(a: { c: CommentRecord; i: number }, b: { c: CommentRecord; i: number }): number {
  const ta = a.c.createdAt ? Date.parse(a.c.createdAt) : Number.POSITIVE_INFINITY;
  const tb = b.c.createdAt ? Date.parse(b.c.createdAt) : Number.POSITIVE_INFINITY;
  return ta === tb ? a.i - b.i : ta - tb;
}

/**
 * Sắp xếp dạng cây: comment gốc theo thời gian, reply nằm ngay dưới comment cha.
 * Reply không tìm thấy cha (cha bị ẩn/xóa) được đặt cuối danh sách của bài.
 */
export function orderThreaded(comments: CommentRecord[]): CommentRecord[] {
  const indexed = comments.map((c, i) => ({ c, i }));
  const ids = new Set(comments.map((c) => c.commentId));
  const children = new Map<string, { c: CommentRecord; i: number }[]>();
  const roots: { c: CommentRecord; i: number }[] = [];
  const orphans: { c: CommentRecord; i: number }[] = [];
  for (const entry of indexed) {
    const parent = entry.c.parentId;
    if (parent === null) roots.push(entry);
    else if (ids.has(parent) && parent !== entry.c.commentId) {
      const list = children.get(parent) ?? [];
      list.push(entry);
      children.set(parent, list);
    } else orphans.push(entry);
  }
  const out: CommentRecord[] = [];
  const visited = new Set<string>();
  const visit = (entry: { c: CommentRecord; i: number }) => {
    if (visited.has(entry.c.commentId)) return;
    visited.add(entry.c.commentId);
    out.push(entry.c);
    for (const child of (children.get(entry.c.commentId) ?? []).sort(byTime)) visit(child);
  };
  roots.sort(byTime).forEach(visit);
  orphans.sort(byTime).forEach(visit);
  // Phòng trường hợp vòng lặp cha-con bất thường: không được làm mất bản ghi.
  indexed.forEach(visit);
  return out;
}

export function indentContent(content: string, depth: number): string {
  const prefix = depth > 0 ? `${'    '.repeat(depth - 1)}↳ ` : '';
  return (prefix + content).slice(0, MAX_CELL_CHARS);
}

export function buildCommentRows(items: ExportItem[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const { comments } of items) {
    for (const c of orderThreaded(comments)) {
      rows.push([
        rows.length + 1,
        c.postUrl,
        getPlatformLabel(c.platform),
        c.commentId,
        c.parentId,
        c.depth,
        c.authorName,
        c.authorProfileUrl,
        indentContent(c.content, c.depth),
        c.reactionCount,
        c.replyCount,
        formatDisplayTime(c.createdAt) || null,
        formatDisplayTime(c.crawledAt) || null,
      ]);
    }
  }
  return rows;
}

export function buildSummaryRows(items: ExportItem[]): Cell[][] {
  return items.map(({ item, comments }) => {
    const roots = comments.filter((c) => c.parentId === null).length;
    const replies = comments.length - roots;
    return [
      item.inputUrl,
      item.platform ? getPlatformLabel(item.platform) : null,
      ITEM_STATUS_LABEL[item.status],
      roots,
      replies,
      comments.length,
      item.expectedTotal,
      formatDisplayTime(item.startedAt) || null,
      formatDisplayTime(item.finishedAt) || null,
      item.error,
    ];
  });
}
