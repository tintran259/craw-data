import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionContext } from '@/adapters/types';
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
    includeReplies: true,
    humanDelay: async () => {},
    lastPayloadAt: () => 0,
    idleStopMs: 0,
    log: (m) => logs.push(m),
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
      document.getElementById('all')!.addEventListener('click', () => clicked.push('all'));
    });
    for (const id of ['more', 'replies', 'reply-action', 'see-more-text']) {
      const el = document.getElementById(id)!;
      el.addEventListener('click', () => {
        clicked.push(id);
        el.remove(); // Facebook thay nút bằng nội dung mới
      });
    }
    await loadAllFacebookComments(makeCtx());
    expect(clicked).toEqual(['sort', 'all', 'replies', 'more']);
  });

  it('không mở reply khi tắt includeReplies', async () => {
    document.body.innerHTML = `<div role="button" id="r">View all 5 replies</div><div role="article"></div>`;
    const spy = vi.fn();
    document.getElementById('r')!.addEventListener('click', spy);
    await loadAllFacebookComments(makeCtx({ includeReplies: false }));
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
});
