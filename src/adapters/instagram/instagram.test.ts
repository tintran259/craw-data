import { describe, expect, it } from 'vitest';
import { InstagramCommentPager } from './graphql-pager';
import { extractInstagramTotalCount, parseInstagramPayload } from './parser';
import { matchInstagramPostUrl, normalizeInstagramUrl } from './url';

const ctx = (requestUrl: string | null = null, requestVariables: string | null = null) => ({
  postUrl: 'https://www.instagram.com/p/ABC123/',
  crawledAt: '2026-10-13T00:00:00.000Z',
  requestUrl,
  requestVariables,
});

const user = (n: string) => ({ pk: `u${n}`, username: `user${n}`, full_name: `User ${n}` });
const comment = (pk: string, extra: Record<string, unknown> = {}) => ({
  pk,
  text: `text ${pk}`,
  created_at: 1_700_000_000,
  user: user(pk),
  comment_like_count: 2,
  child_comment_count: 0,
  ...extra,
});

describe('Instagram url', () => {
  it('nhận link bài / reel và chuẩn hóa', () => {
    expect(matchInstagramPostUrl('https://www.instagram.com/p/ABC123/?igsh=x')).toBe(true);
    expect(matchInstagramPostUrl('instagram.com/someone/reel/R_1-2/')).toBe(true);
    expect(matchInstagramPostUrl('https://www.instagram.com/someone/')).toBe(false);
    expect(normalizeInstagramUrl('https://instagram.com/someone/p/ABC123?utm=1')).toBe(
      'https://www.instagram.com/p/ABC123/',
    );
    expect(normalizeInstagramUrl('https://www.instagram.com/reels/R1/')).toBe(
      'https://www.instagram.com/reel/R1/',
    );
  });
});

describe('Instagram link chia sẻ', () => {
  it('nhận /share/... và không nhầm mã chia sẻ với shortcode', () => {
    expect(matchInstagramPostUrl('https://www.instagram.com/share/p/BAQxyz123/')).toBe(true);
    expect(matchInstagramPostUrl('https://www.instagram.com/share/_ab12Cd')).toBe(true);
    expect(normalizeInstagramUrl('https://www.instagram.com/share/reel/BAQ1?igsh=x')).toBe(
      'https://www.instagram.com/share/reel/BAQ1/',
    );
  });
});

describe('Instagram parser', () => {
  it('REST: comment gốc + reply xem trước, bỏ caption bài viết', () => {
    const raw = JSON.stringify({
      caption: { pk: 'cap', text: 'caption', created_at: 1, user: user('owner'), type: 1 },
      comments: [
        comment('1', {
          child_comment_count: 1,
          preview_child_comments: [comment('11', { parent_comment_id: '1' })],
        }),
        comment('2'),
      ],
      next_min_id: 'x',
    });
    const records = parseInstagramPayload(raw, ctx());
    expect(records.map((r) => [r.commentId, r.parentId, r.depth])).toEqual([
      ['1', null, 0],
      ['11', '1', 1],
      ['2', null, 0],
    ]);
    expect(records[0]).toMatchObject({
      platform: 'instagram',
      authorName: 'User 1',
      authorId: 'u1',
      authorProfileUrl: 'https://www.instagram.com/user1/',
      content: 'text 1',
      reactionCount: 2,
      replyCount: 1,
      createdAt: '2023-11-14T22:13:20.000Z',
    });
  });

  it('REST child_comments: lấy comment cha từ đường dẫn request', () => {
    const raw = JSON.stringify({ child_comments: [comment('21'), comment('22')] });
    const records = parseInstagramPayload(
      raw,
      ctx('https://www.instagram.com/api/v1/media/999/comments/20/child_comments/'),
    );
    expect(records.map((r) => r.parentId)).toEqual(['20', '20']);
  });

  it('GraphQL: edges[].node và comment cha từ biến request', () => {
    const raw = JSON.stringify({
      data: {
        xdt_api__v1__media__media_id__comments__parent_comment_id__child_comments__connection: {
          edges: [{ node: comment('31') }],
        },
      },
    });
    const records = parseInstagramPayload(raw, ctx(null, '{"parent_comment_id":"30"}'));
    expect(records.map((r) => [r.commentId, r.parentId])).toEqual([['31', '30']]);
  });

  it('tổng số bình luận của đúng bài theo shortcode', () => {
    const raw = JSON.stringify({
      items: [
        { code: 'OTHER', comment_count: 999 },
        { code: 'ABC123', comment_count: 42 },
      ],
    });
    expect(extractInstagramTotalCount(raw, 'https://www.instagram.com/p/ABC123/')).toBe(42);
  });
});

describe('InstagramCommentPager', () => {
  const xdt = (pk: string, children = 0, parent: string | null = null) => ({
    __typename: 'XDTCommentDict',
    pk,
    text: `c${pk}`,
    created_at: 1,
    user: { pk: `u${pk}`, username: `u${pk}` },
    child_comment_count: children,
    parent_comment_id: parent,
  });
  const rootConn = (nodes: unknown[], cursor: string | null) => ({
    data: {
      xdt_api__v1__media__media_id__comments__connection: {
        edges: nodes.map((node) => ({ node, cursor: '' })),
        page_info: { end_cursor: cursor, has_next_page: cursor !== null },
      },
    },
  });
  const childConn = (nodes: unknown[], cursor: string | null) => ({
    data: {
      xdt_api__v1__media__media_id__comments__parent_comment_id__child_comments__connection: {
        edges: nodes.map((node) => ({ node, cursor: '' })),
        page_info: { end_cursor: cursor, has_next_page: cursor !== null },
      },
    },
  });

  it('lấy media id từ bài viết trong HTML (khối riêng) và lập request như trang', () => {
    const pager = new InstagramCommentPager({ replyDepth: 1, postCode: 'ABC123' });
    const html = (raw: unknown) =>
      pager.observe({
        operationName: null,
        docId: null,
        variables: null,
        raw: JSON.stringify(raw),
      });
    html({ require: [{ code: 'ABC123', pk: '999', comment_count: 50 }] }); // khối chỉ có bài viết
    html(rootConn([xdt('1', 2), xdt('2')], 'cur1'));

    const root = pager.takeRoot()!;
    expect(root).toMatchObject({ friendlyName: 'PolarisPostCommentsPaginationQuery' });
    expect(root.variables).toEqual({
      after: 'cur1',
      before: null,
      first: 1000,
      last: null,
      media_id: '999',
      sort_order: 'popular',
      __relay_internal__pv__PolarisIsLoggedInrelayprovider: true,
    });
    const thread = pager.takeThread()!;
    expect(thread.variables).toMatchObject({
      parent_comment_id: '1',
      media_id: '999',
      after: null,
    });
    expect(pager.takeThread()).toBeNull(); // bình luận 2 không có reply
  });

  it('Instagram trả 15/trang dù xin 10: phân trang reply bằng cursor tới hết', () => {
    const pager = new InstagramCommentPager({ replyDepth: 1, postCode: null });
    pager.observe({
      operationName: 'PolarisPostCommentsPaginationQuery',
      docId: '1',
      variables: JSON.stringify({ media_id: '999', after: 'x', first: 10, sort_order: 'popular' }),
      raw: JSON.stringify(rootConn([xdt('1', 30)], null)),
    });
    const answer = (raw: unknown) => {
      const req = pager.takeThread()!;
      pager.observe({
        operationName: req.friendlyName,
        docId: req.docId,
        variables: JSON.stringify(req.variables),
        raw: JSON.stringify(raw),
        source: 'api',
      });
      pager.onResult(req, 200, JSON.stringify(raw));
      return req;
    };
    answer(childConn([xdt('11', 0, '1')], 'r1'));
    const second = answer(childConn([xdt('12', 0, '1')], null));
    expect(second.variables).toMatchObject({ after: 'r1', parent_comment_id: '1' });
    expect(pager.isComplete()).toBe(true);
  });

  it('Instagram báo "Please wait a few minutes" → dừng vì bị giới hạn', () => {
    const pager = new InstagramCommentPager({ replyDepth: 0, postCode: null });
    pager.observe({
      operationName: 'PolarisPostCommentsPaginationQuery',
      docId: '1',
      variables: JSON.stringify({ media_id: '999' }),
      raw: JSON.stringify(rootConn([], 'c')),
    });
    const req = pager.takeRoot()!;
    const raw = JSON.stringify({
      message: 'Please wait a few minutes before you try again.',
      status: 'fail',
    });
    expect(pager.onResult(req, 401, raw)).toBe('rate_limited');
  });
});
