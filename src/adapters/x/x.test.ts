import { describe, expect, it } from 'vitest';
import { extractXTotalCount, parseXPayload } from './parser';
import { matchXPostUrl, normalizeXUrl } from './url';

const FOCAL = '1800000000000000100';
const ctx = {
  postUrl: `https://x.com/owner/status/${FOCAL}`,
  crawledAt: '2026-10-13T00:00:00.000Z',
};

const tweet = (id: string, replyTo: string | null, extra: Record<string, unknown> = {}) => ({
  __typename: 'Tweet',
  rest_id: id,
  core: {
    user_results: {
      result: { rest_id: `u${id}`, core: { screen_name: `user${id}`, name: `User ${id}` } },
    },
  },
  legacy: {
    full_text: `@owner reply ${id}`,
    display_text_range: [7, 100],
    created_at: 'Wed Oct 10 20:19:24 +0000 2018',
    favorite_count: 5,
    reply_count: 1,
    in_reply_to_status_id_str: replyTo,
  },
  ...extra,
});
const entry = (result: unknown) => ({
  content: { itemContent: { tweet_results: { result } } },
});
const payload = (...results: unknown[]) =>
  JSON.stringify({
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ type: 'TimelineAddEntries', entries: results.map(entry) }],
      },
    },
  });

describe('X url', () => {
  it('nhận link status và chuẩn hóa sang x.com', () => {
    expect(matchXPostUrl(`https://twitter.com/owner/status/${FOCAL}?s=20`)).toBe(true);
    expect(matchXPostUrl('https://x.com/i/web/status/123')).toBe(true);
    expect(matchXPostUrl('https://x.com/owner')).toBe(false);
    expect(normalizeXUrl(`https://mobile.twitter.com/owner/status/${FOCAL}/photo/1`)).toBe(
      `https://x.com/owner/status/${FOCAL}`,
    );
    expect(normalizeXUrl('https://x.com/i/web/status/123')).toBe('https://x.com/i/status/123');
  });
});

describe('X parser', () => {
  it('lấy reply của tweet gốc và reply lồng; bỏ tweet gốc, tweet phía trên và tweet trích dẫn', () => {
    const ancestor = tweet('1700000000000000000', null);
    const focal = tweet(FOCAL, '1700000000000000000', {
      quoted_status_result: { result: tweet('1900000000000000000', FOCAL) },
    });
    const r1 = tweet('1800000000000000200', FOCAL);
    const r2 = tweet('1800000000000000300', '1800000000000000200');
    const hidden = {
      __typename: 'TweetWithVisibilityResults',
      tweet: { ...tweet('1800000000000000400', FOCAL), __typename: undefined },
    };
    const records = parseXPayload(payload(ancestor, focal, r1, r2, hidden), ctx);
    expect(records.map((r) => [r.commentId, r.parentId, r.depth])).toEqual([
      ['1800000000000000200', null, 0],
      ['1800000000000000300', '1800000000000000200', 1],
      ['1800000000000000400', null, 0],
    ]);
    expect(records[0]).toMatchObject({
      platform: 'x',
      authorName: 'User 1800000000000000200',
      authorProfileUrl: 'https://x.com/user1800000000000000200',
      content: 'reply 1800000000000000200',
      reactionCount: 5,
      createdAt: '2018-10-10T20:19:24.000Z',
    });
  });

  it('ưu tiên nội dung dài (note_tweet) và lấy ảnh', () => {
    const long = tweet('1800000000000000500', FOCAL, {
      note_tweet: { note_tweet_results: { result: { text: 'bài rất dài' } } },
    });
    (long.legacy as Record<string, unknown>).extended_entities = {
      media: [{ media_url_https: 'https://pbs.twimg.com/a.jpg' }],
    };
    expect(parseXPayload(payload(long), ctx)[0]).toMatchObject({
      content: 'bài rất dài',
      attachmentUrls: ['https://pbs.twimg.com/a.jpg'],
    });
  });

  it('tổng số reply của tweet gốc', () => {
    const focal = tweet(FOCAL, null);
    (focal.legacy as Record<string, unknown>).reply_count = 321;
    expect(
      extractXTotalCount(payload(focal, tweet('1800000000000000200', FOCAL)), ctx.postUrl),
    ).toBe(321);
  });
});
