import type { CommentRecord } from '@/adapters/types';

export function commentKey(c: Pick<CommentRecord, 'platform' | 'commentId'>): string {
  return `${c.platform}:${c.commentId}`;
}

/** Gộp hai bản ghi cùng khóa: giữ bản cũ, lấp các trường còn thiếu từ bản mới. */
export function mergeRecord(existing: CommentRecord, c: CommentRecord): CommentRecord {
  return {
    ...existing,
    parentId: existing.parentId ?? c.parentId,
    depth: existing.parentId === null && c.parentId !== null ? c.depth : existing.depth,
    authorId: existing.authorId ?? c.authorId,
    authorProfileUrl: existing.authorProfileUrl ?? c.authorProfileUrl,
    authorName: existing.authorName || c.authorName,
    content: existing.content || c.content,
    attachmentUrls: existing.attachmentUrls.length ? existing.attachmentUrls : c.attachmentUrls,
    reactionCount: existing.reactionCount ?? c.reactionCount,
    replyCount: existing.replyCount ?? c.replyCount,
    createdAt: existing.createdAt ?? c.createdAt,
  };
}
