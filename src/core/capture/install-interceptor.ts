/**
 * Chạy trong MAIN world của trang. Chỉ làm 3 việc: bắt response của endpoint mục tiêu,
 * clone + đọc text, chuyển raw text sang content script. Không parse nghiệp vụ,
 * không sửa/chặn response gốc. Mọi lỗi nội bộ đều bị nuốt để không làm hỏng trang.
 */
import { matchesInterceptTarget } from '@/adapters/intercept-targets';
import {
  INTERCEPTOR_SOURCE,
  isContentMessage,
  type InterceptedResponse,
  type InterceptorMessage,
} from '@/core/messaging/page-bridge';

const INSTALLED_FLAG = '__sceInterceptorInstalled';
/** Số response tối đa giữ lại trong lúc chờ content script xác nhận. */
const PENDING_BUFFER_LIMIT = 200;
/** Không nhận được cấu hình trong khoảng này thì tự tắt (tab không do extension quản lý). */
const PENDING_TIMEOUT_MS = 30_000;

type State = 'pending' | 'on' | 'off';

export function serializeRequestBody(body: unknown): string | null {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const params = new URLSearchParams();
    body.forEach((value, key) => {
      if (typeof value === 'string') params.append(key, value);
    });
    return params.toString();
  }
  return null;
}

export function installInterceptor(win: Window & typeof globalThis): void {
  const flagHost = win as unknown as Record<string, unknown>;
  if (flagHost[INSTALLED_FLAG]) return;
  Object.defineProperty(win, INSTALLED_FLAG, { value: true });

  let state: State = 'pending';
  const buffer: InterceptedResponse[] = [];

  const post = (msg: InterceptorMessage) => {
    try {
      win.postMessage(msg, win.location.origin);
    } catch {
      /* bỏ qua */
    }
  };

  const emit = (data: InterceptedResponse) => {
    if (state === 'off') return;
    if (state === 'pending') {
      buffer.push(data);
      if (buffer.length > PENDING_BUFFER_LIMIT) buffer.shift();
      return;
    }
    post({ source: INTERCEPTOR_SOURCE, type: 'response', data });
  };

  const pendingTimer = win.setTimeout(() => {
    if (state === 'pending') {
      state = 'off';
      buffer.length = 0;
    }
  }, PENDING_TIMEOUT_MS);

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== win || !isContentMessage(event.data)) return;
    win.clearTimeout(pendingTimer);
    if (event.data.enabled) {
      state = 'on';
      for (const data of buffer.splice(0))
        post({ source: INTERCEPTOR_SOURCE, type: 'response', data });
    } else {
      state = 'off';
      buffer.length = 0;
    }
  });

  /** Trả về origin + pathname nếu là endpoint mục tiêu (bỏ query để không lộ token). */
  const targetUrl = (raw: string): string | null => {
    try {
      const url = new URL(raw, win.location.href);
      return matchesInterceptTarget(url) ? url.origin + url.pathname : null;
    } catch {
      return null;
    }
  };

  // ---- fetch ----
  const originalFetch = win.fetch;
  if (typeof originalFetch === 'function') {
    const patchedFetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      let target: string | null = null;
      let bodyPromise: Promise<string | null> = Promise.resolve(null);
      if (state !== 'off') {
        try {
          const [input, init] = args;
          const rawUrl =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          target = targetUrl(rawUrl);
          if (target) {
            if (init && 'body' in init) {
              bodyPromise = Promise.resolve(serializeRequestBody(init.body));
            } else if (input instanceof Request) {
              // Clone trước khi fetch gốc tiêu thụ body.
              bodyPromise = input
                .clone()
                .text()
                .catch(() => null);
            }
          }
        } catch {
          target = null;
        }
      }

      const promise = Reflect.apply(originalFetch, this, args) as Promise<Response>;

      if (target) {
        const requestUrl = target;
        // Gắn handler trước khi trả promise cho trang => clone() chạy trước khi trang đọc body.
        promise.then(
          (response) => {
            try {
              const copy = response.clone();
              Promise.all([copy.text(), bodyPromise])
                .then(([responseText, requestBody]) =>
                  emit({
                    requestUrl,
                    requestBody,
                    status: response.status,
                    responseText,
                    capturedAt: new Date().toISOString(),
                  }),
                )
                .catch(() => {});
            } catch {
              /* bỏ qua */
            }
          },
          () => {},
        );
      }
      return promise;
    };
    win.fetch = patchedFetch as typeof fetch;
  }

  // ---- XMLHttpRequest ----
  const proto = win.XMLHttpRequest?.prototype;
  if (proto) {
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const targets = new WeakMap<XMLHttpRequest, string>();

    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        const target = state === 'off' ? null : targetUrl(String(args[1]));
        if (target) targets.set(this, target);
        else targets.delete(this);
      } catch {
        /* bỏ qua */
      }
      return Reflect.apply(originalOpen, this, args) as void;
    } as typeof proto.open;

    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const requestUrl = targets.get(this);
      if (requestUrl && state !== 'off') {
        try {
          const requestBody = serializeRequestBody(body);
          this.addEventListener(
            'load',
            function (this: XMLHttpRequest) {
              try {
                if (this.responseType !== '' && this.responseType !== 'text') return;
                emit({
                  requestUrl,
                  requestBody,
                  status: this.status,
                  responseText: this.responseText,
                  capturedAt: new Date().toISOString(),
                });
              } catch {
                /* bỏ qua */
              }
            },
            { once: true },
          );
        } catch {
          /* bỏ qua */
        }
      }
      return Reflect.apply(originalSend, this, [body]) as void;
    };
  }

  post({ source: INTERCEPTOR_SOURCE, type: 'ready' });
}
