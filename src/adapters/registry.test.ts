import { describe, expect, it } from 'vitest';
import { detectPlatform, findAdapterForUrl, getAdapter } from './registry';

describe('registry', () => {
  it('nhận diện nền tảng từ URL', () => {
    expect(detectPlatform('https://www.facebook.com/a/posts/1')).toBe('facebook');
    expect(detectPlatform('https://www.instagram.com/p/abc/')).toBe('instagram');
    expect(detectPlatform('https://www.threads.net/@a/post/1')).toBe('threads');
    expect(detectPlatform('https://www.tiktok.com/@a/video/1')).toBe('tiktok');
    expect(detectPlatform('https://twitter.com/a/status/1')).toBe('x');
    expect(detectPlatform('https://example.com')).toBeNull();
  });

  it('Facebook, Instagram, Threads, X có adapter; TikTok chưa', () => {
    expect(getAdapter('facebook')?.id).toBe('facebook');
    expect(getAdapter('instagram')?.id).toBe('instagram');
    expect(getAdapter('threads')?.id).toBe('threads');
    expect(getAdapter('x')?.id).toBe('x');
    expect(getAdapter('tiktok')).toBeNull();
    expect(findAdapterForUrl('https://www.instagram.com/reel/Cx1/')?.id).toBe('instagram');
    expect(findAdapterForUrl('https://www.threads.net/@a/post/Cx1')?.id).toBe('threads');
    expect(findAdapterForUrl('https://twitter.com/a/status/123')?.id).toBe('x');
    expect(findAdapterForUrl('https://x.com/a')).toBeNull();
    expect(findAdapterForUrl('https://www.facebook.com/reel/1')?.id).toBe('facebook');
    expect(findAdapterForUrl('https://www.facebook.com/somepage')).toBeNull();
  });
});
