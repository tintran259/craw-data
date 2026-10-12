import { describe, expect, it } from 'vitest';
import { detectFacebookBlock } from './block-detector';

function docWith(html: string, path = '/somepage/posts/1'): Document {
  const doc = document.implementation.createHTMLDocument('x');
  doc.body.innerHTML = html;
  Object.defineProperty(doc, 'location', { value: new URL(`https://www.facebook.com${path}`) });
  return doc;
}

describe('detectFacebookBlock', () => {
  it('trang bình thường', () => {
    expect(
      detectFacebookBlock(docWith('<div role="main"><div role="article">hi</div></div>')),
    ).toBeNull();
  });
  it('checkpoint', () => {
    expect(detectFacebookBlock(docWith('', '/checkpoint/1501092823525282/'))?.code).toBe(
      'checkpoint',
    );
  });
  it('yêu cầu đăng nhập', () => {
    expect(detectFacebookBlock(docWith('', '/login/'))?.code).toBe('login_required');
    expect(
      detectFacebookBlock(docWith('<form id="login_form"><input name="pass"></form>'))?.code,
    ).toBe('login_required');
  });
  it('bị giới hạn tốc độ (EN + VI)', () => {
    expect(
      detectFacebookBlock(docWith('<div role="dialog">You’re Temporarily Blocked</div>'))?.code,
    ).toBe('rate_limited');
    expect(
      detectFacebookBlock(
        docWith('<div role="dialog">Có vẻ như bạn đang dùng tính năng này quá nhanh</div>'),
      )?.code,
    ).toBe('rate_limited');
  });
  it('nội dung không khả dụng', () => {
    expect(
      detectFacebookBlock(docWith('<div role="main">This content isn\'t available right now</div>'))
        ?.code,
    ).toBe('unavailable');
    expect(
      detectFacebookBlock(docWith('<div role="main">Bạn hiện không xem được nội dung này</div>'))
        ?.code,
    ).toBe('unavailable');
  });
});
