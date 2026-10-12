import { browser, type Browser } from 'wxt/browser';
import { toUserMessage } from '@/shared/errors';
import {
  CHANNEL,
  type BroadcastEnvelope,
  type BroadcastMap,
  type BroadcastType,
  type RequestEnvelope,
  type RequestMap,
  type RequestType,
  type ResponseEnvelope,
} from './protocol';

export * from './protocol';

type MessageSender = Browser.runtime.MessageSender;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isRequest(msg: unknown): msg is RequestEnvelope {
  return isObject(msg) && msg.channel === CHANNEL && msg.kind === 'request';
}

function isBroadcast(msg: unknown): msg is BroadcastEnvelope {
  return isObject(msg) && msg.channel === CHANNEL && msg.kind === 'broadcast';
}

/** Gửi request tới background. Lỗi phía background được throw lại dưới dạng Error tiếng Việt. */
export async function sendRequest<K extends RequestType>(
  type: K,
  ...args: RequestMap[K]['req'] extends void ? [] : [RequestMap[K]['req']]
): Promise<RequestMap[K]['res']> {
  const envelope: RequestEnvelope<K> = {
    channel: CHANNEL,
    kind: 'request',
    type,
    payload: args[0] as RequestMap[K]['req'],
  };
  const response = (await browser.runtime.sendMessage(envelope)) as
    ResponseEnvelope<RequestMap[K]['res']> | undefined;
  if (!response) throw new Error('Không nhận được phản hồi từ extension. Hãy tải lại extension.');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export type RequestHandlers = {
  [K in RequestType]: (
    payload: RequestMap[K]['req'],
    sender: MessageSender,
  ) => Promise<RequestMap[K]['res']> | RequestMap[K]['res'];
};

/** Đăng ký handler ở background. Phải gọi đồng bộ khi service worker khởi động. */
export function registerRequestHandlers(handlers: RequestHandlers): void {
  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (!isRequest(msg)) return false;
    const handler = handlers[msg.type] as (
      payload: unknown,
      sender: MessageSender,
    ) => Promise<unknown> | unknown;
    Promise.resolve()
      .then(() => handler(msg.payload, sender))
      .then(
        (data) => sendResponse({ ok: true, data } satisfies ResponseEnvelope<unknown>),
        (err: unknown) =>
          sendResponse({
            ok: false,
            error: toUserMessage(err),
          } satisfies ResponseEnvelope<unknown>),
      );
    return true; // giữ kênh mở cho sendResponse bất đồng bộ
  });
}

/** Gửi thông báo tới side panel. Bỏ qua lỗi khi side panel đang đóng. */
export function broadcast<K extends BroadcastType>(type: K, payload: BroadcastMap[K]): void {
  const envelope: BroadcastEnvelope<K> = { channel: CHANNEL, kind: 'broadcast', type, payload };
  browser.runtime.sendMessage(envelope).catch(() => {
    /* side panel đóng: không có ai nhận */
  });
}

export function onBroadcast<K extends BroadcastType>(
  type: K,
  listener: (payload: BroadcastMap[K]) => void,
): () => void {
  const wrapped = (msg: unknown) => {
    if (isBroadcast(msg) && msg.type === type) listener(msg.payload as BroadcastMap[K]);
    return false;
  };
  browser.runtime.onMessage.addListener(wrapped);
  return () => browser.runtime.onMessage.removeListener(wrapped);
}
