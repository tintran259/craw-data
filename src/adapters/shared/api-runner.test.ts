import { describe, expect, it } from 'vitest';
import { BlockedError } from '@/adapters/errors';
import type { GraphqlAccess, GraphqlCall } from '@/adapters/types';
import { FacebookCommentPager } from '@/adapters/facebook/graphql-pager';
import { runApi } from './api-runner';

const comment = (cid: string, replies: number) => ({
  __typename: 'Comment',
  id: btoa(`comment:1_${cid}`),
  legacy_fbid: cid,
  depth: 0,
  author: { name: cid },
  body: { text: cid },
  feedback: {
    id: btoa(`feedback:1_${cid}`),
    expansion_info: { expansion_token: `tok-${cid}` },
    replies_fields: { count: replies },
  },
});
const rootPage = (cid: string, cursor: string | null) =>
  JSON.stringify({
    data: {
      node: {
        id: 'FB_POST',
        comment_rendering_instance_for_feed_location: {
          comments: {
            edges: [{ node: comment(cid, 1) }],
            page_info: { end_cursor: cursor, has_next_page: cursor !== null },
          },
        },
      },
    },
  });
const emptyReplies = JSON.stringify({
  data: {
    node: {
      replies_connection: { edges: [], page_info: { end_cursor: 'x', has_next_page: false } },
    },
  },
});

/** Giả lập GraphqlAccess: trả lời sau một nhịp event loop, ghi lại thứ tự và số request đồng thời. */
function fakeAccess(pager: FacebookCommentPager, respond: (call: GraphqlCall) => string) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const access: GraphqlAccess = {
    subscribe: () => () => {},
    ready: () => true,
    async request(call) {
      calls.push(call.friendlyName);
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 0));
      const raw = respond(call);
      pager.observe({
        operationName: call.friendlyName,
        docId: call.docId,
        variables: JSON.stringify(call.variables),
        raw,
        source: 'api',
      });
      inFlight--;
      return { status: 200, raw };
    },
    delay: async () => {},
    sleep: async () => {},
    replyLanes: 2,
    probeFeedLocation: false,
  };
  return { access, calls, maxInFlight: () => maxInFlight };
}

const hooks = { check: () => {}, log: () => {}, onProgress: () => {} };

describe('runApi', () => {
  it('tải reply song song, gối đầu với chuỗi bình luận gốc', async () => {
    const pager = new FacebookCommentPager({ replyDepth: 1 });
    pager.observe({ operationName: null, docId: null, variables: null, raw: rootPage('p0', 'c1') });
    const pages: Record<string, string> = { c1: rootPage('p1', 'c2'), c2: rootPage('p2', 'c3') };
    const fake = fakeAccess(pager, (call) =>
      call.friendlyName.startsWith('Comments')
        ? (pages[call.variables.commentsAfterCursor as string] ?? rootPage('p3', null))
        : emptyReplies,
    );

    await runApi(pager, fake.access, hooks);

    const roots = fake.calls.filter((c) => c.startsWith('Comments')).length;
    const replies = fake.calls.filter((c) => c.startsWith('Depth1')).length;
    expect([roots, replies]).toEqual([3, 4]);
    // Reply đầu tiên chạy trước khi chuỗi gốc kết thúc, và có lúc nhiều request cùng chạy.
    expect(fake.calls.indexOf('Depth1CommentsListPaginationQuery')).toBeLessThan(
      fake.calls.lastIndexOf('CommentsListComponentsPaginationQuery'),
    );
    expect(fake.maxInFlight()).toBeGreaterThan(1);
    expect(pager.isComplete()).toBe(true);
  });

  it('Facebook báo giới hạn tốc độ: dừng mọi luồng và báo bị chặn', async () => {
    const pager = new FacebookCommentPager({ replyDepth: 1 });
    pager.observe({ operationName: null, docId: null, variables: null, raw: rootPage('p0', 'c1') });
    const limited = JSON.stringify({ errors: [{ code: 1675004, message: 'Rate limit exceeded' }] });
    const fake = fakeAccess(pager, () => limited);
    await expect(runApi(pager, fake.access, hooks)).rejects.toBeInstanceOf(BlockedError);
    expect(fake.calls.length).toBeLessThanOrEqual(3); // không gửi tiếp sau khi bị chặn
  });

  it('hủy giữa chừng (check throw): dừng và ném lại lỗi', async () => {
    const pager = new FacebookCommentPager({ replyDepth: 0 });
    pager.observe({ operationName: null, docId: null, variables: null, raw: rootPage('p0', 'c1') });
    const fake = fakeAccess(pager, () => rootPage('n', 'next'));
    let n = 0;
    const stop = new Error('hủy');
    const check = () => {
      if (++n > 3) throw stop;
    };
    await expect(runApi(pager, fake.access, { ...hooks, check })).rejects.toBe(stop);
  });
});
