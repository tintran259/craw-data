/**
 * Giao thức window.postMessage giữa interceptor (MAIN world) và content script (isolated world).
 * File này không được import gì khác vì được bundle vào interceptor.
 */
export const INTERCEPTOR_SOURCE = 'sce-interceptor';
export const CONTENT_SOURCE = 'sce-content';

export interface InterceptedResponse {
  requestUrl: string;
  /** Body request dạng text (form-urlencoded với Facebook). Không rời khỏi tab. */
  requestBody: string | null;
  status: number;
  responseText: string;
  capturedAt: string;
}

export type InterceptorMessage =
  | { source: typeof INTERCEPTOR_SOURCE; type: 'ready' }
  | { source: typeof INTERCEPTOR_SOURCE; type: 'response'; data: InterceptedResponse };

export interface ContentToInterceptorMessage {
  source: typeof CONTENT_SOURCE;
  type: 'config';
  enabled: boolean;
}

export function isInterceptorMessage(data: unknown): data is InterceptorMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === INTERCEPTOR_SOURCE
  );
}

export function isContentMessage(data: unknown): data is ContentToInterceptorMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === CONTENT_SOURCE &&
    (data as { type?: unknown }).type === 'config'
  );
}
