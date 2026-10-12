import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CommentRecord } from '@/adapters/types';
import { addComments, clearComments, getCommentsForItem } from './comments-db';

const rec = (commentId: string, parentId: string | null = null): CommentRecord => ({
  postUrl: 'u',
  platform: 'facebook',
  commentId,
  parentId,
  depth: parentId ? 1 : 0,
  authorName: 'A',
  authorId: null,
  authorProfileUrl: null,
  content: 'x',
  attachmentUrls: [],
  reactionCount: null,
  replyCount: null,
  createdAt: null,
  crawledAt: 't',
});

describe('comments-db', () => {
  it('khử trùng lặp, đếm gốc/reply, tách theo link', async () => {
    expect(await addComments('a', [rec('1'), rec('2', '1')])).toEqual({
      addedRoots: 1,
      addedReplies: 1,
    });
    expect(await addComments('a', [rec('1'), rec('2', '1'), rec('3')])).toEqual({
      addedRoots: 1,
      addedReplies: 0,
    });
    await addComments('b', [rec('1')]);
    expect((await getCommentsForItem('a')).map((c) => c.commentId)).toEqual(['1', '2', '3']);
    expect(await getCommentsForItem('b')).toHaveLength(1);
    await clearComments();
    expect(await getCommentsForItem('a')).toEqual([]);
  });
});
