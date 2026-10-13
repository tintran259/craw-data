import { describe, expect, it } from 'vitest';
import {
  FB_COMMENT_OPS,
  FacebookCommentPager,
  PAGE_SIZES,
  type PlannedRequest,
} from './graphql-pager';

/** Payload tổng hợp theo đúng cấu trúc quan sát trong dữ liệu thật (xem graphql-pager.ts). */
const comment = (cid: string, depth: number, replies = 0) => ({
  __typename: 'Comment',
  id: btoa(`comment:1_${cid}`),
  legacy_fbid: cid,
  depth,
  author: { name: `A${cid}`, id: `u${cid}` },
  body: { text: `c${cid}` },
  created_time: 1_700_000_000,
  feedback: {
    id: btoa(`feedback:1_${cid}`),
    expansion_info: { expansion_token: `tok-${cid}` },
    replies_fields: { count: replies, total_count: replies },
  },
});
type Node = ReturnType<typeof comment>;
const rootPage = (nodes: Node[], endCursor: string | null, hasNext: boolean) =>
  JSON.stringify({
    data: {
      node: {
        __typename: 'Feedback',
        id: 'FB_POST',
        comment_rendering_instance_for_feed_location: {
          comments: {
            edges: nodes.map((node) => ({ node })),
            page_info: { end_cursor: endCursor, has_next_page: hasNext },
          },
        },
      },
    },
  });
const replyPage = (nodes: Node[], endCursor: string | null, hasNext: boolean) =>
  JSON.stringify({
    data: {
      node: {
        replies_connection: {
          edges: nodes.map((node) => ({ node })),
          page_info: { end_cursor: endCursor, has_next_page: hasNext },
        },
      },
    },
  });

const ROOT_QUERY_VARS = JSON.stringify({
  commentsIntentToken: 'RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1',
  feedLocation: 'COMET_MEDIA_VIEWER',
  id: 'FB_POST',
  __relay_internal__pv__IsWorkUserrelayprovider: true,
});

/** Trang vừa đổi sang "Tất cả bình luận": Facebook trả trang gốc đầu tiên. */
function startedPager(replyDepth: 0 | 1 | 2, firstPage: string) {
  const pager = new FacebookCommentPager({ replyDepth: replyDepth });
  pager.observe({
    operationName: 'CommentListComponentsRootQuery',
    docId: '111',
    variables: ROOT_QUERY_VARS,
    raw: firstPage,
  });
  return pager;
}

/** Chạy pager như vòng lặp thật: lập request → "gửi" → observe → onResult. */
function drain(
  pager: FacebookCommentPager,
  respond: (req: PlannedRequest) => { status?: number; raw: string },
  limit = 50,
): PlannedRequest[] {
  const sent: PlannedRequest[] = [];
  for (let req = pager.next(); req && sent.length < limit; req = pager.next()) {
    sent.push(req);
    const { status = 200, raw } = respond(req);
    if (status === 200) {
      pager.observe({
        operationName: req.friendlyName,
        docId: req.docId,
        variables: JSON.stringify(req.variables),
        raw,
      });
    }
    pager.onResult(req, status, raw);
  }
  return sent;
}

describe('FacebookCommentPager', () => {
  it('phân trang bình luận gốc bằng cursor, xin trang lớn, dùng biến học được từ trang', () => {
    const pager = startedPager(0, rootPage([comment('1', 0)], 'cur1', true));
    expect(pager.handles('root')).toBe(true);
    const sent = drain(pager, (req) =>
      req.variables.commentsAfterCursor === 'cur1'
        ? { raw: rootPage([comment('2', 0)], 'cur2', true) }
        : { raw: rootPage([comment('3', 0)], 'cur3', false) },
    );
    expect(sent.map((r) => r.variables.commentsAfterCursor)).toEqual(['cur1', 'cur2']);
    expect(sent[0]).toMatchObject({
      kind: 'root',
      friendlyName: FB_COMMENT_OPS.root.name,
      docId: FB_COMMENT_OPS.root.docId,
      variables: {
        commentsAfterCount: 1000,
        id: 'FB_POST',
        feedLocation: 'COMET_MEDIA_VIEWER',
        commentsIntentToken: 'RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1',
        __relay_internal__pv__IsWorkUserrelayprovider: true,
        __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
      },
    });
  });

  it('ưu tiên doc_id thấy trong request thật của trang', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    pager.observe({
      operationName: FB_COMMENT_OPS.root.name,
      docId: '999',
      variables: null,
      raw: rootPage([], 'cur2', true),
    });
    expect(pager.next()).toMatchObject({
      docId: '999',
      variables: { commentsAfterCursor: 'cur2' },
    });
  });

  it('hết bình luận gốc rồi mới tải reply, theo cấp được chọn', () => {
    const first = rootPage([comment('1', 0, 3), comment('2', 0), comment('3', 0, 1)], null, false);
    const respond = (req: PlannedRequest) => {
      if (req.variables.id === btoa('feedback:1_1')) {
        return req.variables.repliesAfterCursor
          ? { raw: replyPage([comment('12', 1)], 'r1b', false) }
          : { raw: replyPage([comment('11', 1, 2)], 'r1a', true) };
      }
      if (req.variables.id === btoa('feedback:1_3')) {
        return { raw: replyPage([comment('31', 1)], 'r3', false) };
      }
      return { raw: replyPage([comment('111', 2)], 's', false) };
    };

    const all = drain(startedPager(2, first), respond);
    expect(all.map((r) => [r.kind, r.variables.id])).toEqual([
      ['depth1', btoa('feedback:1_1')],
      ['depth1', btoa('feedback:1_1')], // trang 2: tải xong một nhánh rồi mới sang nhánh sau
      ['depth1', btoa('feedback:1_3')],
      ['depth2', btoa('feedback:1_11')],
    ]);
    // Trang đầu và trang sau của nhánh đều xin trang lớn (mỗi loại có bộ dò riêng).
    expect(all[0]!.variables).toMatchObject({ repliesAfterCursor: null, repliesAfterCount: 1000 });
    expect(all[1]!.variables).toMatchObject({
      repliesAfterCursor: 'r1a',
      repliesAfterCount: 1000,
      expansionToken: 'tok-1',
    });
    expect(all[3]!.variables).toMatchObject({
      subRepliesAfterCursor: null,
      expansionToken: 'tok-11',
    });

    expect(drain(startedPager(1, first), respond).map((r) => r.kind)).not.toContain('depth2');
    expect(drain(startedPager(0, first), respond)).toEqual([]);
  });

  it('dùng expansion_token mới nhất của nhánh (Facebook cấp lại khi comment xuất hiện lại)', () => {
    const c = comment('1', 0, 2);
    const pager = startedPager(1, rootPage([c], null, false));
    const again = {
      ...c,
      feedback: { ...c.feedback, expansion_info: { expansion_token: 'tok-new' } },
    };
    pager.observe({
      operationName: null,
      docId: null,
      variables: null,
      raw: rootPage([again], null, false),
    });
    expect(pager.next()?.variables.expansionToken).toBe('tok-new');
  });

  it('thử 1000 → 500 → 200 → 100 → 50 → mặc định khi Facebook từ chối, không tính là lỗi', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    const sent = drain(pager, (req) =>
      req.variables.commentsAfterCount !== -1
        ? { raw: JSON.stringify({ errors: [{ message: 'bad count' }] }) }
        : { raw: rootPage([comment('2', 0)], null, false) },
    );
    expect(sent.map((r) => r.variables.commentsAfterCount)).toEqual([...PAGE_SIZES, -1]);
    expect(pager.handles('root')).toBe(true);
  });

  it('dừng ở bậc lớn nhất Facebook nhận', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    const many = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => comment(String(from + i), 0));
    let page = 0;
    const sent = drain(pager, (req) => {
      const count = req.variables.commentsAfterCount as number;
      if (count > 200) return { raw: JSON.stringify({ errors: [{ message: 'too big' }] }) };
      page++;
      return { raw: rootPage(many(count, page * 1000), page < 3 ? `c${page}` : null, page < 3) };
    });
    expect(sent.map((r) => r.variables.commentsAfterCount)).toEqual([1000, 500, 200, 200, 200]);
    expect(pager.pageSizeLine()).toBe(
      'Số bình luận mỗi trang Facebook cho: gốc 200/trang (xin 200).',
    );
  });

  it('Facebook nhận nhưng âm thầm trả ít hơn: hạ số xin xuống bậc sát nhất', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    let page = 0;
    const sent = drain(pager, () => {
      page++;
      const nodes = Array.from({ length: 70 }, (_, i) => comment(`${page}-${i}`, 0));
      return { raw: rootPage(nodes, page < 3 ? `c${page}` : null, page < 3) };
    });
    expect(sent.map((r) => r.variables.commentsAfterCount)).toEqual([1000, 100, 100]);
    expect(pager.pageSizeLine()).toBe(
      'Số bình luận mỗi trang Facebook cho: gốc 70/trang (xin 100).',
    );
  });

  it('Facebook cố định 10/trang (như dữ liệu thật): quay về gửi giá trị mặc định', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    let page = 0;
    const sent = drain(pager, () => {
      page++;
      const nodes = Array.from({ length: 10 }, (_, i) => comment(`${page}-${i}`, 0));
      return { raw: rootPage(nodes, page < 3 ? `c${page}` : null, page < 3) };
    });
    expect(sent.map((r) => r.variables.commentsAfterCount)).toEqual([1000, -1, -1]);
    expect(pager.pageSizeLine()).toBe(
      'Số bình luận mỗi trang Facebook cho: gốc 10/trang (Facebook cố định, không tăng được).',
    );
  });

  it('đã nhận một kích thước thì lỗi sau đó không hạ bậc (coi là lỗi tạm thời)', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    let n = 0;
    const sent = drain(pager, () => {
      n++;
      if (n === 2) return { status: 500, raw: '' };
      const nodes = Array.from({ length: 1000 }, (_, i) => comment(`${n}-${i}`, 0));
      return { raw: rootPage(nodes, n < 3 ? `c${n}` : null, n < 3) };
    });
    expect(sent.map((r) => r.variables.commentsAfterCount)).toEqual([1000, 1000, 1000]);
  });

  it('lỗi liên tiếp thì tắt API cho loại đó (để quay về bấm nút)', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    const sent = drain(pager, () => ({ status: 500, raw: '' }));
    expect(sent).toHaveLength(PAGE_SIZES.length + 3); // dò hết các bậc + 3 lần mặc định
    expect(pager.handles('root')).toBe(false);
    expect(pager.next()).toBeNull();
    expect(pager.describe()).toContain('Đã tắt API cho gốc');
  });

  it('coi trả về đúng trang cũ (cursor không đổi) là lỗi — không lặp vô hạn', () => {
    const pager = startedPager(0, rootPage([], 'same', true));
    const sent = drain(pager, () => ({ raw: rootPage([], 'same', true) }));
    expect(sent.length).toBeLessThanOrEqual(PAGE_SIZES.length + 3);
    expect(pager.handles('root')).toBe(false);
  });

  it('lỗi trang rỗng tạm thời (1675012): chờ và thử lại, không tắt API, không hạ bậc', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    const transient = JSON.stringify({ errors: [{ code: 1675012, message: 'empty' }] });
    const outcomes = Array.from({ length: 4 }, () => {
      const req = pager.next()!;
      expect(req.variables.commentsAfterCount).toBe(1000);
      return pager.onResult(req, 200, transient);
    });
    expect(outcomes).toEqual(['backoff', 'backoff', 'backoff', 'backoff']);
    expect(pager.handles('root')).toBe(true);
    const sent = drain(pager, () => ({ raw: rootPage([comment('1', 0)], null, false) }));
    expect(sent).toHaveLength(1);
    expect(pager.isComplete()).toBe(true);
  });

  it('nhận ra lỗi giới hạn tốc độ', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    const req = pager.next()!;
    const raw = JSON.stringify({ errors: [{ code: 1675004, message: 'Rate limit exceeded' }] });
    expect(pager.onResult(req, 200, raw)).toBe('rate_limited');
  });

  it('bỏ qua danh sách bình luận của video khác trong query không phải bình luận', () => {
    const pager = new FacebookCommentPager({ replyDepth: 2 });
    pager.observe({
      operationName: 'FBUnifiedVideoContainerQuery',
      docId: '1',
      variables: null,
      raw: rootPage([comment('9', 0)], 'other', true),
    });
    expect(pager.handles('root')).toBe(false);
  });

  it('ghi chú tóm tắt số request', () => {
    const pager = startedPager(0, rootPage([], 'cur1', true));
    drain(pager, () => ({
      raw: rootPage([comment('2', 0), comment('3', 0)], null, false),
    }));
    expect(pager.describe()).toBe(
      'Chế độ nhanh (API): 1 request (gốc 1, reply cấp 1 0, reply cấp 2 0). Trung bình 2 bình luận gốc/request.',
    );
    expect(pager.pageSizeLine()).toBe(
      'Số bình luận mỗi trang Facebook cho: gốc nhận 1000/trang (bài chưa đủ dài để biết mức tối đa).',
    );
  });
});

describe('FacebookCommentPager — chạy song song, chạy tiếp, chỉ lấy mới', () => {
  /** Response API (source = api) của chính pager. */
  const answer = (pager: FacebookCommentPager, req: PlannedRequest, raw: string) => {
    pager.observe({
      operationName: req.friendlyName,
      docId: req.docId,
      variables: JSON.stringify(req.variables),
      raw,
      source: 'api',
    });
    return pager.onResult(req, 200, raw);
  };

  it('nhiều luồng: không giao trùng nhánh; chuỗi gốc chỉ một request tại một thời điểm', () => {
    const pager = startedPager(
      2,
      rootPage([comment('1', 0, 2), comment('2', 0, 1), comment('3', 0, 1)], 'cur1', true),
    );
    const root = pager.takeRoot()!;
    expect(pager.takeRoot()).toBeNull(); // trang gốc kế tiếp phải chờ cursor
    const a = pager.takeThread()!;
    const b = pager.takeThread()!;
    const c = pager.takeThread()!;
    expect(new Set([a.threadId, b.threadId, c.threadId]).size).toBe(3);
    expect(pager.takeThread()).toBeNull();
    expect(pager.mayProduceWork()).toBe(true);
    expect(pager.isComplete()).toBe(false);

    answer(pager, root, rootPage([], null, false));
    for (const t of [a, b, c]) answer(pager, t, replyPage([], 'r', false));
    expect(pager.mayProduceWork()).toBe(false);
    expect(pager.isComplete()).toBe(true);
  });

  it('changed() báo khi có trang / nhánh mới', async () => {
    const pager = startedPager(1, rootPage([], 'cur1', true));
    const root = pager.takeRoot()!;
    let woke = false;
    const waiting = pager.changed().then(() => (woke = true));
    answer(pager, root, rootPage([comment('9', 0, 1)], null, false));
    await waiting;
    expect(woke).toBe(true);
    expect(pager.takeThread()?.threadId).toBe(btoa('feedback:1_9'));
  });

  it('chạy tiếp: dùng cursor đã lưu, bỏ qua lô đầu trang tự tải lại', () => {
    const first = startedPager(2, rootPage([comment('1', 0, 3)], 'cur1', true));
    const req = first.takeRoot()!;
    answer(first, req, rootPage([comment('2', 0)], 'cur2', true));
    const saved = JSON.parse(JSON.stringify(first.snapshot()));
    expect(saved).toMatchObject({
      v: 2,
      ownerId: 'FB_POST',
      rootCursor: 'cur2',
      rootHasNext: true,
    });
    expect(saved.threads.map((t: { id: string }) => t.id)).toEqual([btoa('feedback:1_1')]);

    const next = new FacebookCommentPager({ replyDepth: 2 });
    expect(next.restore(saved)).toBe(true);
    // Trang mở lại từ đầu: không được ghi đè cursor đã lưu.
    next.observe({
      operationName: 'CommentListComponentsRootQuery',
      docId: '1',
      variables: null,
      raw: rootPage([comment('1', 0, 3)], 'cur1', true),
      source: 'page',
    });
    const resumed = next.takeRoot()!;
    expect(resumed).toMatchObject({ resumed: true, variables: { commentsAfterCursor: 'cur2' } });
    expect(answer(next, resumed, rootPage([], 'cur3', true))).toBe('ok');
    expect(next.takeRoot()).toMatchObject({
      resumed: false,
      variables: { commentsAfterCursor: 'cur3' },
    });
  });

  it('chạy tiếp: cursor cũ hết hạn thì quay về trang đầu, không tính là lỗi', () => {
    const next = new FacebookCommentPager({ replyDepth: 0 });
    next.restore({
      v: 2,
      ownerId: 'FB_POST',
      rootCursor: 'old',
      rootHasNext: true,
      learned: { feedLocation: 'POST_PERMALINK_DIALOG', intentToken: 'X' },
      threads: [],
    });
    next.observe({
      operationName: null,
      docId: null,
      variables: null,
      raw: rootPage([], 'page1', true),
      source: 'page',
    });
    // Lỗi: trước hết hạ bậc kích thước trang (cursor cũ vẫn có thể dùng được), hết bậc mới bỏ cursor.
    let req = next.takeRoot()!;
    for (let i = 0; req.variables.commentsAfterCursor === 'old' && i < 10; i++) {
      expect(req.resumed).toBe(true);
      expect(next.onResult(req, 500, '')).toBe('retry');
      req = next.takeRoot()!;
    }
    expect(req.variables.commentsAfterCursor).toBe('page1');
    expect(next.describe()).toContain('Cursor lần trước đã hết hạn');
  });

  it('chạy tiếp: nhánh reply lưu từ trước hết hạn thì bỏ qua nhánh đó', () => {
    const next = new FacebookCommentPager({ replyDepth: 1 });
    next.restore({
      v: 2,
      ownerId: 'FB_POST',
      rootCursor: null,
      rootHasNext: false,
      learned: { feedLocation: 'POST_PERMALINK_DIALOG', intentToken: 'X' },
      threads: [{ id: 'fbX', token: 'stale', parentDepth: 0, cursor: 'c' }],
    });
    let t = next.takeThread();
    for (let i = 0; t && i < 10; i++) {
      expect(t).toMatchObject({ resumed: true, threadId: 'fbX' });
      expect(next.onResult(t, 200, '{}')).toBe('retry');
      t = next.takeThread();
    }
    expect(t).toBeNull();
    expect(next.isComplete()).toBe(true);
    expect(next.describe()).toContain('Bỏ qua 1 nhánh reply');
  });

  it('chỉ lấy bình luận mới: dừng chuỗi gốc khi gặp bình luận không mới hơn mốc', () => {
    const at = (cid: string, t: number) => ({ ...comment(cid, 0), created_time: t });
    const pager = new FacebookCommentPager({ replyDepth: 0, onlyNewerThan: 1000 });
    pager.observe({
      operationName: 'CommentListComponentsRootQuery',
      docId: '1',
      variables: null,
      raw: rootPage([at('5', 3000), at('4', 2000)], 'cur1', true),
    });
    const req = pager.takeRoot()!;
    answer(pager, req, rootPage([at('3', 1500), at('2', 900)], 'cur2', true));
    expect(pager.takeRoot()).toBeNull();
    expect(pager.isComplete()).toBe(true);
    expect(pager.describe()).toContain('Đã tới bình luận của lần chạy trước');
  });

  it('thử nghiệm dò feedLocation: chọn giá trị cho trang lớn nhất', () => {
    const pager = new FacebookCommentPager({ replyDepth: 0, probeFeedLocation: true });
    pager.observe({
      operationName: 'CommentListComponentsRootQuery',
      docId: '1',
      variables: JSON.stringify({ feedLocation: 'POST_PERMALINK_DIALOG' }),
      raw: rootPage([], 'c0', true),
    });
    const many = (n: number, p: string) =>
      Array.from({ length: n }, (_, i) => comment(`${p}${i}`, 0));
    let page = 0;
    for (let req = pager.takeRoot(); req; req = pager.takeRoot()) {
      const loc = req.variables.feedLocation as string;
      page++;
      const raw =
        loc === 'NEWSFEED'
          ? JSON.stringify({ errors: [{ message: 'bad enum' }] })
          : rootPage(many(loc === 'PERMALINK' ? 25 : 10, `p${page}-`), `c${page}`, page < 12);
      answer(pager, req, raw);
    }
    expect(pager.describe()).toContain(
      'Dò feedLocation: dùng PERMALINK (25 bình luận/trang thay vì 10)',
    );
  });
});
