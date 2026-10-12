import { describe, expect, it } from 'vitest';
import { matchFacebookPostUrl, normalizeFacebookUrl } from './url';

describe('matchFacebookPostUrl', () => {
  it.each([
    'https://www.facebook.com/somepage/posts/pfbid0abc123',
    'https://www.facebook.com/somepage/posts/123456789/',
    'https://m.facebook.com/permalink.php?story_fbid=123&id=456',
    'https://www.facebook.com/groups/mygroup/posts/987654321/',
    'https://www.facebook.com/groups/123/permalink/456/',
    'https://www.facebook.com/share/p/1AbCdEf/',
    'https://www.facebook.com/share/r/1AbCdEf/',
    'https://www.facebook.com/photo/?fbid=123&set=a.456',
    'https://www.facebook.com/photo.php?fbid=123',
    'https://www.facebook.com/somepage/photos/a.1/2/',
    'https://www.facebook.com/reel/123456',
    'https://www.facebook.com/somepage/videos/123456/',
    'https://www.facebook.com/watch/?v=123',
    'https://www.facebook.com/story.php?story_fbid=1&id=2',
    'facebook.com/reel/123',
    'https://web.facebook.com/somepage/posts/1',
  ])('chấp nhận %s', (url) => {
    expect(matchFacebookPostUrl(url)).toBe(true);
  });

  it.each([
    'https://www.facebook.com/',
    'https://www.facebook.com/somepage',
    'https://www.facebook.com/permalink.php',
    'https://www.facebook.com/photo/',
    'https://notfacebook.com/somepage/posts/1',
    'https://www.instagram.com/p/abc/',
    'not a url',
    'javascript:alert(1)',
  ])('từ chối %s', (url) => {
    expect(matchFacebookPostUrl(url)).toBe(false);
  });
});

describe('normalizeFacebookUrl', () => {
  it('bỏ tracking param, fragment và dấu / cuối, ép về www', () => {
    expect(
      normalizeFacebookUrl('https://m.facebook.com/somepage/posts/123/?__cft__[0]=x&__tn__=R#c'),
    ).toBe('https://www.facebook.com/somepage/posts/123');
  });

  it('giữ param xác định bài viết', () => {
    expect(
      normalizeFacebookUrl('https://www.facebook.com/permalink.php?story_fbid=1&id=2&ref=abc'),
    ).toBe('https://www.facebook.com/permalink.php?story_fbid=1&id=2');
    expect(normalizeFacebookUrl('https://www.facebook.com/photo/?fbid=9&set=a.1&mibextid=x')).toBe(
      'https://www.facebook.com/photo?fbid=9&set=a.1',
    );
  });
});
