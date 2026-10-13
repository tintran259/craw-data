import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionContext, GraphqlAccess, GraphqlCall, ObservedPayload } from '@/adapters/types';
import { loadAllFacebookComments } from './actions';

/** happy-dom không tính layout; coi mọi element là hiển thị. */
Element.prototype.getClientRects = function () {
  return [{}] as unknown as DOMRectList;
};
Element.prototype.scrollIntoView = () => {};

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext & { logs: string[] } {
  const logs: string[] = [];
  return {
    signal: new AbortController().signal,
    replyDepth: 2,
    graphql: null,
    humanDelay: async () => {},
    afterClick: async () => {},
    lastPayloadAt: () => 0,
    idleStopMs: 0,
    log: (m) => logs.push(m),
    report: () => {},
    onlyNewerThan: null,
    resume: null,
    checkpoint: () => {},
    logs,
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('loadAllFacebookComments', () => {
  it('chuyển sang Tất cả bình luận, bấm xem thêm và mở reply rồi dừng', async () => {
    document.body.innerHTML = `
      <div role="main">
        <div role="button" id="sort">Phù hợp nhất</div>
        <div role="article">c1</div>
        <div role="button" id="more">Xem thêm bình luận</div>
        <div role="button" id="replies">Xem tất cả 3 phản hồi</div>
        <div role="button" id="reply-action">Phản hồi</div>
        <div role="button" id="see-more-text">Xem thêm</div>
      </div>`;
    const clicked: string[] = [];
    document.getElementById('sort')!.addEventListener('click', () => {
      clicked.push('sort');
      const menu = document.createElement('div');
      menu.innerHTML =
        '<div role="menuitem" id="all">Tất cả bình luận Hiển thị tất cả bình luận</div>';
      document.body.append(menu);
      document.getElementById('all')!.addEventListener('click', () => {
        clicked.push('all');
        menu.remove();
        document.getElementById('sort')!.textContent = 'Tất cả bình luận';
      });
    });
    for (const id of ['more', 'replies', 'reply-action', 'see-more-text']) {
      const el = document.getElementById(id)!;
      el.addEventListener('click', () => {
        clicked.push(id);
        el.remove(); // Facebook thay nút bằng nội dung mới
      });
    }
    await loadAllFacebookComments(makeCtx());
    expect(clicked).toEqual(['sort', 'all', 'more', 'replies']);
  });

  /** Nút sắp xếp + menu; `applies` = Facebook có thực sự đổi bộ lọc khi chọn hay không. */
  function mountSort(label: string, applies = true) {
    const sort = document.createElement('div');
    sort.setAttribute('role', 'button');
    sort.textContent = label;
    const clicks = { sort: 0, all: 0 };
    sort.addEventListener('click', () => {
      clicks.sort++;
      const item = document.createElement('div');
      item.setAttribute('role', 'menuitem');
      item.textContent = 'Tất cả bình luận';
      item.addEventListener('click', () => {
        clicks.all++;
        item.remove();
        if (applies) sort.textContent = 'Tất cả bình luận';
      });
      document.body.append(item);
    });
    return { sort, clicks };
  }

  it('đã ở "Tất cả bình luận" thì không bấm đổi', async () => {
    document.body.innerHTML = '<div role="article"></div>';
    const { sort, clicks } = mountSort('Tất cả bình luận');
    document.body.prepend(sort);
    const note = await loadAllFacebookComments(makeCtx());
    expect(clicks.sort).toBe(0);
    expect(note).toContain('Bộ lọc: "Tất cả bình luận"');
  });

  it('chờ nút sắp xếp xuất hiện muộn rồi chuyển từ "Phù hợp nhất"', async () => {
    document.body.innerHTML = '<div role="article"></div>';
    const { sort, clicks } = mountSort('Phù hợp nhất');
    let rounds = 0;
    const note = await loadAllFacebookComments(
      makeCtx({
        humanDelay: async () => {
          if (++rounds === 2) document.body.prepend(sort); // khung bình luận hiện chậm
        },
      }),
    );
    expect(clicks).toEqual({ sort: 1, all: 1 });
    expect(sort.textContent).toBe('Tất cả bình luận');
    expect(note).toContain('Bộ lọc: "Tất cả bình luận"');
  });

  it('thử lại và báo trong ghi chú khi Facebook không đổi bộ lọc', async () => {
    document.body.innerHTML = '<div role="article"></div>';
    const { sort, clicks } = mountSort('Phù hợp nhất', false);
    document.body.prepend(sort);
    const note = await loadAllFacebookComments(makeCtx());
    expect(clicks.all).toBe(2);
    expect(note).toContain(
      'Không chuyển được sang "Tất cả bình luận" (bộ lọc vẫn là "phù hợp nhất")',
    );
  });

  it('chỉ lấy bình luận mới: chuyển bộ lọc sang "Mới nhất"', async () => {
    document.body.innerHTML = '<div role="article"></div>';
    const sort = document.createElement('div');
    sort.setAttribute('role', 'button');
    sort.textContent = 'Phù hợp nhất';
    sort.addEventListener('click', () => {
      for (const label of ['Tất cả bình luận', 'Mới nhất']) {
        const item = document.createElement('div');
        item.setAttribute('role', 'menuitem');
        item.textContent = label;
        item.addEventListener('click', () => {
          sort.textContent = label;
          document.querySelectorAll('[role="menuitem"]').forEach((el) => el.remove());
        });
        document.body.append(item);
      }
    });
    document.body.prepend(sort);
    const note = await loadAllFacebookComments(makeCtx({ onlyNewerThan: 1_700_000_000 }));
    expect(sort.textContent).toBe('Mới nhất');
    expect(note).toContain('Bộ lọc: "Mới nhất"');
    expect(note).toContain('Chỉ lấy bình luận mới hơn lần chạy trước');
  });

  it('báo trong ghi chú khi không thấy nút sắp xếp', async () => {
    document.body.innerHTML = '<div role="article"></div>';
    const note = await loadAllFacebookComments(makeCtx());
    expect(note).toContain('Không thấy nút sắp xếp bình luận');
  });

  it('không mở reply khi chọn không lấy reply', async () => {
    document.body.innerHTML = `<div role="button" id="r">View all 5 replies</div><div role="article"></div>`;
    const spy = vi.fn();
    document.getElementById('r')!.addEventListener('click', spy);
    await loadAllFacebookComments(makeCtx({ replyDepth: 0 }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('nhận diện nút tiếng Anh', async () => {
    document.body.innerHTML = `
      <div role="article"></div>
      <div role="button" id="a">View more comments</div>
      <div role="button" id="b">Nguyen Van A replied · 2 Replies</div>
      <div role="button" id="c">View 1 reply</div>`;
    const clicked: string[] = [];
    for (const id of ['a', 'b', 'c']) {
      const el = document.getElementById(id)!;
      el.addEventListener('click', () => {
        clicked.push(id);
        el.remove();
      });
    }
    await loadAllFacebookComments(makeCtx());
    expect(clicked.sort()).toEqual(['a', 'b', 'c']);
  });

  it('mở khung bình luận khi trang (Reel) chưa hiển thị bình luận', async () => {
    document.body.innerHTML = `<div role="button" aria-label="Bình luận" id="t"></div>`;
    const spy = vi.fn(() => {
      document.body.insertAdjacentHTML('beforeend', '<div role="article">c</div>');
    });
    document.getElementById('t')!.addEventListener('click', spy);
    await loadAllFacebookComments(makeCtx());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('dừng ngay khi bị chặn', async () => {
    document.body.innerHTML = `<div role="dialog">You're Temporarily Blocked</div>`;
    await expect(loadAllFacebookComments(makeCtx())).rejects.toThrow(/quá nhanh/);
  });

  it('không bấm cùng một nút mãi nếu nó không biến mất', async () => {
    document.body.innerHTML = `<div role="article"></div><div role="button" id="m">View more comments</div>`;
    const spy = vi.fn();
    document.getElementById('m')!.addEventListener('click', spy);
    await loadAllFacebookComments(makeCtx());
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('nhận diện nút có số dạng 4,381 / 4.381 / 1,2K', async () => {
    const labels = [
      'View 4,381 more comments',
      'Xem thêm 4.381 bình luận',
      'Xem tất cả 1,2K phản hồi',
      'View all 1,234 replies',
      'Nguyen Van A đã trả lời · 1.024 phản hồi',
    ];
    document.body.innerHTML =
      '<div role="article"></div>' +
      labels.map((l, i) => `<div role="button" id="b${i}">${l}</div>`).join('');
    const clicked: string[] = [];
    labels.forEach((l, i) => {
      const el = document.getElementById(`b${i}`)!;
      el.addEventListener('click', () => {
        clicked.push(l);
        el.remove();
      });
    });
    await loadAllFacebookComments(makeCtx());
    expect(clicked.sort()).toEqual([...labels].sort());
  });

  it('ghi chú số lần bấm, nút không phản hồi và nút chưa nhận diện', async () => {
    document.body.innerHTML = `
      <div role="article"></div>
      <div role="button" id="m">Xem thêm bình luận</div>
      <div role="button">Hiện 25 bình luận mới</div>`;
    const note = await loadAllFacebookComments(makeCtx());
    expect(note).toContain('Đã bấm 3 lần "xem thêm bình luận", 0 lần "xem phản hồi"');
    expect(note).toContain('Không có dữ liệu mới khi bấm "xem thêm bình luận"');
    expect(note).toContain('Nút chưa nhận diện: "hiện 25 bình luận mới"');
  });

  it('tiếp tục bấm cùng một nút khi mỗi lần bấm đều tải thêm dữ liệu', async () => {
    document.body.innerHTML = `<div role="article"></div><div role="button" id="m">Xem thêm bình luận</div>`;
    let payloadAt = 0;
    const el = document.getElementById('m')!;
    const spy = vi.fn(() => {
      payloadAt++; // mỗi lần bấm Facebook trả về một trang bình luận mới
      if (spy.mock.calls.length === 10) el.remove();
    });
    el.addEventListener('click', spy);
    await loadAllFacebookComments(makeCtx({ lastPayloadAt: () => payloadAt }));
    expect(spy).toHaveBeenCalledTimes(10);
  });

  it('chế độ nhanh: tải gốc + reply bằng API, không bấm nút API đã lo', async () => {
    const page = (cursor: string | null, hasNext: boolean, edges: unknown[]) =>
      JSON.stringify({
        data: {
          node: {
            id: 'FB_POST',
            comment_rendering_instance_for_feed_location: {
              comments: { edges, page_info: { end_cursor: cursor, has_next_page: hasNext } },
            },
          },
        },
      });
    const withReplies = {
      node: {
        __typename: 'Comment',
        id: 'c1',
        depth: 0,
        author: {},
        body: { text: 'x' },
        feedback: {
          id: 'fb1',
          expansion_info: { expansion_token: 't1' },
          replies_fields: { count: 1 },
        },
      },
    };
    const listeners = new Set<(p: ObservedPayload) => void>();
    const calls: GraphqlCall[] = [];
    let payloadAt = 0;
    const graphql: GraphqlAccess = {
      subscribe(fn) {
        fn({
          operationName: 'CommentListComponentsRootQuery',
          docId: '1',
          variables: null,
          raw: page('cur1', true, []),
        });
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      ready: () => true,
      async request(call) {
        calls.push(call);
        payloadAt++;
        const raw =
          call.friendlyName === 'CommentsListComponentsPaginationQuery'
            ? page(null, false, [withReplies])
            : JSON.stringify({
                data: {
                  node: {
                    replies_connection: {
                      edges: [],
                      page_info: { end_cursor: 'r', has_next_page: false },
                    },
                  },
                },
              });
        for (const fn of listeners) {
          fn({
            operationName: call.friendlyName,
            docId: call.docId,
            variables: JSON.stringify(call.variables),
            raw,
          });
        }
        return { status: 200, raw };
      },
      delay: async () => {},
      sleep: async () => {},
      replyLanes: 2,
      probeFeedLocation: false,
    };
    document.body.innerHTML = `
      <div role="article"></div>
      <div role="button" id="more">Xem thêm bình luận</div>`;
    const spy = vi.fn();
    document.getElementById('more')!.addEventListener('click', spy);

    const note = await loadAllFacebookComments(
      makeCtx({ graphql, lastPayloadAt: () => payloadAt }),
    );
    expect(calls.map((c) => c.friendlyName)).toEqual([
      'CommentsListComponentsPaginationQuery',
      'Depth1CommentsListPaginationQuery',
    ]);
    expect(spy).not.toHaveBeenCalled();
    expect(note).toContain('Chế độ nhanh (API): 2 request (gốc 1, reply cấp 1 1, reply cấp 2 0)');
  });
});
