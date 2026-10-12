import { describe, expect, it } from 'vitest';
import { parseLinkInput } from './links';

describe('parseLinkInput', () => {
  it('bỏ dòng trống, link trùng, link không hợp lệ và báo lý do', () => {
    const result = parseLinkInput(
      [
        'https://www.facebook.com/page/posts/1?__tn__=x',
        '',
        '   ',
        'https://m.facebook.com/page/posts/1/',
        'hello world',
        'https://www.facebook.com/somepage',
        'https://example.com/a',
        'https://www.instagram.com/p/abc/',
        'https://www.facebook.com/reel/123',
      ].join('\n'),
    );
    expect(result.links.map((l) => [l.normalizedUrl, l.platform, l.supported])).toEqual([
      ['https://www.facebook.com/page/posts/1', 'facebook', true],
      ['https://www.instagram.com/p/abc/', 'instagram', false],
      ['https://www.facebook.com/reel/123', 'facebook', true],
    ]);
    expect(result.rejected.map((r) => [r.line, r.reason])).toEqual([
      [4, 'Trùng với dòng 1'],
      [5, 'Không phải link hợp lệ'],
      [6, 'Không phải link bài viết Facebook (cần link /posts/, /reel/, /share/p/, ...)'],
      [7, 'Không nhận diện được mạng xã hội'],
    ]);
  });
});
