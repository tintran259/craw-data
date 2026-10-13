import { describe, expect, it } from 'vitest';
import { ThreadsCommentPager } from './graphql-pager';
import { extractThreadsTotalCount, parseThreadsPayload } from './parser';
import { matchThreadsPostUrl, normalizeThreadsUrl } from './url';

const ctx = {
  postUrl: 'https://www.threads.com/@owner/post/ROOT',
  crawledAt: '2026-10-13T00:00:00.000Z',
};

/** Post / reply theo cấu trúc thật: `reply_level` 0 = bài, 1 = reply trực tiếp, 2+ = lồng nhau. */
const post = (code: string, pk: string, level: number, extra: Record<string, unknown> = {}) => ({
  pk,
  id: `${pk}_99`,
  code,
  taken_at: 1_700_000_000,
  like_count: 3,
  caption: { text: `text ${code}` },
  user: { pk: `u${pk}`, id: `u${pk}`, username: `user${pk}` },
  text_post_app_info: { reply_level: level, direct_reply_count: 0 },
  ...extra,
});
type Post = ReturnType<typeof post>;
/** Danh sách reply của `ownerPk` (direct_replies hoặc inline_expansion); mỗi phần tử là một chuỗi. */
const list = (
  key: 'direct_replies' | 'inline_expansion',
  ownerPk: string,
  chains: Post[][],
  cursor: string | null = null,
) => ({
  data: {
    media: {
      id: `${ownerPk}_99`,
      text_post_app_info: {
        [key]: {
          edges: chains.map((chain) => ({
            node: {
              __typename: 'XDTTextAppThreadView',
              posts: { edges: chain.map((node) => ({ node })), page_info: {} },
            },
          })),
          page_info: { end_cursor: cursor, has_next_page: cursor !== null },
        },
      },
    },
  },
});

describe('Threads url', () => {
  it('nhận link bài và chuẩn hóa sang threads.com', () => {
    expect(matchThreadsPostUrl('https://www.threads.net/@a.b/post/C1x-Y?xmt=1')).toBe(true);
    expect(matchThreadsPostUrl('https://www.threads.com/@a.b')).toBe(false);
    expect(normalizeThreadsUrl('threads.net/@a.b/post/C1x-Y/media')).toBe(
      'https://www.threads.com/@a.b/post/C1x-Y',
    );
  });

  it('nhận /share/{mã} và giữ nguyên dạng share khi chuẩn hóa', () => {
    expect(matchThreadsPostUrl('https://www.threads.com/share/GNTEqgNJo/')).toBe(true);
    expect(matchThreadsPostUrl('threads.net/share/GNTEqgNJo')).toBe(true);
    expect(normalizeThreadsUrl('https://www.threads.net/share/GNTEqgNJo?x=1')).toBe(
      'https://www.threads.com/share/GNTEqgNJo/',
    );
  });
});

describe('Threads parser', () => {
  it('reply trực tiếp: chuỗi post — post sau trả lời post trước; bỏ bài gốc', () => {
    const raw = JSON.stringify({
      root: post('ROOT', '0', 0),
      ...list('direct_replies', '0', [[post('A', '1', 1), post('B', '2', 2)], [post('C', '3', 1)]]),
    });
    const records = parseThreadsPayload(raw, ctx);
    expect(records.map((r) => [r.commentId, r.parentId, r.depth])).toEqual([
      ['1', null, 0],
      ['2', '1', 1],
      ['3', null, 0],
    ]);
    expect(records[0]).toMatchObject({
      platform: 'threads',
      content: 'text A',
      authorProfileUrl: 'https://www.threads.com/@user1',
      reactionCount: 3,
    });
  });

  it('khối HTML không chứa bài gốc: reply cấp 1 vẫn là bình luận gốc', () => {
    const raw = JSON.stringify(list('direct_replies', '0', [[post('A', '1', 1)]]));
    expect(parseThreadsPayload(raw, ctx).map((r) => [r.commentId, r.parentId])).toEqual([
      ['1', null],
    ]);
  });

  it('mở rộng reply lồng nhau: post đầu trả lời post được mở rộng', () => {
    const raw = JSON.stringify(
      list('inline_expansion', '1', [
        [post('X', '11', 2)],
        [post('Y', '12', 2), post('Z', '13', 3)],
      ]),
    );
    const records = parseThreadsPayload(raw, {
      ...ctx,
      requestVariables: JSON.stringify({ permalinkPostID: '0', postID: '1', after: null }),
    });
    expect(records.map((r) => [r.commentId, r.parentId, r.depth])).toEqual([
      ['11', '1', 1],
      ['12', '1', 1],
      ['13', '12', 2],
    ]);
  });

  it('danh sách reply của một reply khác (vd. DownwardQuery): cha là chủ danh sách', () => {
    const raw = JSON.stringify(list('direct_replies', '1', [[post('W', '21', 2)]]));
    const records = parseThreadsPayload(raw, {
      ...ctx,
      requestVariables: JSON.stringify({ postID: '1', sortOrder: 'TOP' }),
    });
    expect(records.map((r) => [r.commentId, r.parentId, r.depth])).toEqual([['21', '1', 1]]);
  });

  it('link trỏ tới một reply: bỏ bài gốc và các bài phía trên nó', () => {
    const raw = JSON.stringify({
      up: post('UP', '9', 0),
      root: post('ROOT', '0', 1),
      ...list('direct_replies', '0', [[post('E', '5', 2)]]),
    });
    expect(parseThreadsPayload(raw, ctx).map((r) => [r.commentId, r.parentId, r.depth])).toEqual([
      ['5', null, 0],
    ]);
  });

  it('nhập link share: dùng URL trang (đã chuyển sang bài thật) để bỏ bài gốc', () => {
    const shareCtx = {
      postUrl: 'https://www.threads.com/share/GNTEqgNJo/',
      pageUrl: 'https://www.threads.com/@owner/post/ROOT',
      crawledAt: '2026-10-13T00:00:00.000Z',
    };
    const root = post('ROOT', '0', 0, {
      text_post_app_info: { reply_level: 0, direct_reply_count: 1 },
    });
    const raw = JSON.stringify({ root, ...list('direct_replies', '0', [[post('A', '1', 1)]]) });
    expect(parseThreadsPayload(raw, shareCtx).map((r) => r.commentId)).toEqual(['1']);
    expect(extractThreadsTotalCount(raw, shareCtx.pageUrl)).toBe(1);
  });

  it('đọc nội dung từ text_fragments và ảnh carousel', () => {
    const p = post('F', '6', 1, {
      caption: null,
      text_post_app_info: {
        reply_level: 1,
        text_fragments: { fragments: [{ plaintext: 'Xin ' }, { plaintext: 'chào' }] },
      },
      carousel_media: [{ image_versions2: { candidates: [{ url: 'https://img/1.jpg' }] } }],
    });
    const raw = JSON.stringify(list('direct_replies', '0', [[p]]));
    expect(parseThreadsPayload(raw, ctx)[0]).toMatchObject({
      content: 'Xin chào',
      attachmentUrls: ['https://img/1.jpg'],
    });
  });
});

describe('ThreadsCommentPager', () => {
  const relay = { __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: true };
  const observe = (
    pager: ThreadsCommentPager,
    operationName: string | null,
    raw: unknown,
    vars: unknown = null,
    source: 'page' | 'api' = 'page',
  ) =>
    pager.observe({
      operationName,
      docId: operationName ? 'doc' : null,
      variables: vars ? JSON.stringify(vars) : null,
      raw: JSON.stringify(raw),
      source,
    });
  const withReplies = (p: Post, n: number) => ({
    ...p,
    text_post_app_info: { ...p.text_post_app_info, direct_reply_count: n },
  });

  it('chỉ tự gọi sau khi học được biến từ request của trang', () => {
    const pager = new ThreadsCommentPager({ replyDepth: 2, postCode: 'ROOT' });
    observe(pager, null, {
      root: post('ROOT', '0', 0),
      ...list('direct_replies', '0', [[withReplies(post('A', '1', 1), 3)]], 'c1'),
    });
    expect(pager.handles('root')).toBe(false); // chưa có biến relay
    expect(pager.takeRoot()).toBeNull();
    expect(pager.isComplete()).toBe(false);

    // Trang tự tải trang 2 (khi cuộn) → học biến, từ đó pager tiếp quản.
    observe(
      pager,
      'BarcelonaPostPageDirectRepliesRefetchQuery',
      list('direct_replies', '0', [[post('B', '2', 1)]], 'c2'),
      { after: 'c1', filterType: null, first: 4, postID: '0', sortOrder: 'TOP', ...relay },
    );
    const root = pager.takeRoot()!;
    expect(root.variables).toMatchObject({ after: 'c2', postID: '0', sortOrder: 'TOP', ...relay });
    expect(root.variables.first).toBe(1000); // dò kích thước trang
    const thread = pager.takeThread()!;
    expect(thread.variables).toEqual({ after: null, permalinkPostID: '0', postID: '1', ...relay });
  });

  it('bỏ qua danh sách reply của post khác khi đã biết bài gốc', () => {
    const pager = new ThreadsCommentPager({ replyDepth: 0, postCode: 'ROOT' });
    observe(pager, null, { root: post('ROOT', '0', 0) });
    observe(pager, null, list('direct_replies', '1', [[post('W', '21', 2)]], 'x'));
    expect(pager.snapshot()).toBeNull(); // chưa thấy danh sách của bài gốc
  });
});
