import { describe, expect, it } from 'vitest';
import type { CommentRecord } from '@/adapters/types';
import { mergeComments } from './dedupe';

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

describe('mergeComments', () => {
  it('khử trùng lặp theo platform + commentId và lấp trường thiếu', () => {
    const map = new Map<string, CommentRecord>();
    expect(mergeComments(map, [base, { ...base, commentId: 'c2' }])).toBe(2);
    expect(mergeComments(map, [{ ...base, reactionCount: 5, authorId: '9' }])).toBe(0);
    expect(map.size).toBe(2);
    expect(map.get('facebook:c1')).toMatchObject({
      reactionCount: 5,
      authorId: '9',
      content: 'hi 😀',
    });
  });
});
