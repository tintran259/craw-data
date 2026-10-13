import { describe, expect, it, vi } from 'vitest';
import { CONTENT_SOURCE, type InterceptorMessage } from '@/core/messaging/page-bridge';
import {
  installInterceptor,
  pickRequestHeaders,
  serializeRequestBody,
} from './install-interceptor';

const GRAPHQL = 'https://www.facebook.com/api/graphql/';

function createFakeWindow(responseText: string) {
  const listeners: ((e: MessageEvent) => void)[] = [];
  const posted: InterceptorMessage[] = [];
  const originalFetch = vi.fn(async () => new Response(responseText, { status: 200 }));
  const win = {
    location: { href: 'https://www.facebook.com/a/posts/1', origin: 'https://www.facebook.com' },
    fetch: originalFetch,
    XMLHttpRequest: undefined,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    addEventListener: (_type: string, l: (e: MessageEvent) => void) => listeners.push(l),
    postMessage: (msg: InterceptorMessage) => posted.push(msg),
  };
  const sendConfig = (enabled: boolean) =>
    listeners.forEach((l) =>
      l({ source: win, data: { source: CONTENT_SOURCE, type: 'config', enabled } } as never),
    );
  return { win: win as unknown as Window & typeof globalThis, posted, originalFetch, sendConfig };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('installInterceptor', () => {
  it('giữ nguyên response cho trang và chuyển raw text sau khi được bật', async () => {
    const raw = 'for (;;);{"data":{"x":1}}\n{"extensions":{}}';
    const { win, posted, sendConfig } = createFakeWindow(raw);
    installInterceptor(win);
    expect(posted[0]).toMatchObject({ type: 'ready' });

    const res = await win.fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'X-CSRFToken': 'csrf', 'X-IG-App-ID': '936', 'Content-Type': 'text/plain' },
      body: new URLSearchParams({ fb_api_req_friendly_name: 'Q', fb_dtsg: 't' }),
    });
    // Trang vẫn đọc được body bình thường.
    expect(await res.text()).toBe(raw);
    await flush();
    // Đang chờ cấu hình: chưa gửi gì, chỉ buffer.
    expect(posted).toHaveLength(1);

    sendConfig(true);
    expect(posted).toHaveLength(2);
    const msg = posted[1];
    expect(msg?.type).toBe('response');
    if (msg?.type === 'response') {
      expect(msg.data.responseText).toBe(raw);
      expect(msg.data.requestUrl).toBe(GRAPHQL);
      expect(msg.data.requestBody).toContain('fb_api_req_friendly_name=Q');
      // Header x-* để chế độ nhanh gửi lại giống trang (không lấy header khác).
      expect(msg.data.requestHeaders).toEqual({ 'x-csrftoken': 'csrf', 'x-ig-app-id': '936' });
    }
  });

  it('chỉ giữ header x-* từ object, Headers và mảng cặp', () => {
    expect(pickRequestHeaders(new Headers({ 'X-ASBD-ID': '1', Accept: '*/*' }))).toEqual({
      'x-asbd-id': '1',
    });
    expect(
      pickRequestHeaders([
        ['x-fb-lsd', 'L'],
        ['cookie', 'c'],
      ]),
    ).toEqual({ 'x-fb-lsd': 'L' });
    expect(pickRequestHeaders({ accept: 'json' })).toBeNull();
    expect(pickRequestHeaders(undefined)).toBeNull();
  });

  it('bỏ qua request không phải mục tiêu và khi bị tắt', async () => {
    const { win, posted, sendConfig } = createFakeWindow('x');
    installInterceptor(win);
    sendConfig(true);
    await win.fetch('https://www.facebook.com/ajax/other');
    await flush();
    expect(posted).toHaveLength(1);

    sendConfig(false);
    await win.fetch(GRAPHQL);
    await flush();
    expect(posted).toHaveLength(1);
  });

  it('không cài đặt hai lần', () => {
    const { win, originalFetch } = createFakeWindow('x');
    installInterceptor(win);
    const patched = win.fetch;
    installInterceptor(win);
    expect(win.fetch).toBe(patched);
    expect(win.fetch).not.toBe(originalFetch);
  });
});

describe('serializeRequestBody', () => {
  it('hỗ trợ string, URLSearchParams, FormData', () => {
    expect(serializeRequestBody('a=1')).toBe('a=1');
    expect(serializeRequestBody(new URLSearchParams({ a: '1' }))).toBe('a=1');
    const fd = new FormData();
    fd.append('a', '1');
    expect(serializeRequestBody(fd)).toBe('a=1');
    expect(serializeRequestBody(new Blob(['x']))).toBeNull();
    expect(serializeRequestBody(undefined)).toBeNull();
  });
});
