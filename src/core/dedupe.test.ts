import { describe, expect, it } from 'vitest';
import type { CommentRecord } from '@/adapters/types';
import { commentKey, mergeRecord } from './dedupe';

const base: CommentRecord = {
  postUrl: 'u',
  platform: 'facebook',
  commentId: 'c1',
  parentId: null,
  depth: 0,
  authorName: 'A',
  authorId: null,
  authorProfileUrl: null,
  content: 'hi 😀',
  attachmentUrls: [],
  reactionCount: null,
  replyCount: null,
  createdAt: null,
  crawledAt: '2026-01-01T00:00:00.000Z',
};

describe('dedupe', () => {
  it('khóa theo platform + commentId', () => {
    expect(commentKey(base)).toBe('facebook:c1');
  });

  it('gộp: giữ bản cũ, lấp các trường còn thiếu từ bản mới', () => {
    const merged = mergeRecord(base, { ...base, reactionCount: 5, authorId: '9', content: 'khác' });
    expect(merged).toMatchObject({ reactionCount: 5, authorId: '9', content: 'hi 😀' });
  });

  it('gộp: bản mới cho biết comment cha thì nhận cả cha lẫn độ sâu', () => {
    const merged = mergeRecord(base, { ...base, parentId: 'p', depth: 1 });
    expect(merged).toMatchObject({ parentId: 'p', depth: 1 });
  });
});
