import type { BlockCode, CommentRecord, Platform } from '@/adapters/types';
import type { QueueState } from '@/core/queue/types';
import type { Settings } from '@/core/storage/settings';
import type { Range } from '@/shared/utils/delay';

/** Cấu hình cho một lần thu thập bình luận trong tab. */
export interface JobConfig {
  itemId: string;
  actionDelayMs: Range;
  idleStopMs: number;
  includeReplies: boolean;
}

/** Vai trò của một tab do extension mở. Tab không có mode thì content script đứng yên. */
export interface TabMode {
  platform: Platform;
  /** Link người dùng nhập — ghi vào cột "Link bài viết". */
  postUrl: string;
  purpose: 'debug' | 'job';
  /** Khác null: lưu raw payload vào phiên debug này (Debug mode). */
  debugSessionId: string | null;
  /** Khác null: thu thập bình luận và tự động tải hết. */
  job: JobConfig | null;
}

export type JobOutcome = 'done' | 'error' | 'blocked';

export type CaptureKind = 'graphql' | 'html-json';

export interface CapturedPayload {
  kind: CaptureKind;
  pageUrl: string;
  /** Chỉ origin + pathname, không có query. */
  requestUrl: string | null;
  operationName: string | null;
  docId: string | null;
  variables: string | null;
  status: number | null;
  raw: string;
  capturedAt: string;
}

export interface DebugSession {
  id: string;
  postUrl: string;
  platform: Platform;
  tabId: number | null;
  startedAt: string;
  endedAt: string | null;
  graphqlCount: number;
  htmlJsonCount: number;
  /** Số khối JSON trong HTML bị bỏ vì không liên quan tới bình luận. */
  skippedHtmlBlocks: number;
  totalBytes: number;
}

export interface DebugStatus {
  activeSessionId: string | null;
  sessions: DebugSession[];
}

/** Request: gửi từ side panel / content script tới background, có response. */
export interface RequestMap {
  'settings/get': { req: void; res: Settings };
  'settings/update': { req: Partial<Settings>; res: Settings };
  'tab/getMode': { req: void; res: TabMode | null };
  'capture/payloads': {
    req: { payloads: CapturedPayload[]; skippedHtmlBlocks?: number };
    res: void;
  };
  'debug/start': { req: { url: string }; res: DebugStatus };
  'debug/stop': { req: void; res: DebugStatus };
  'debug/status': { req: void; res: DebugStatus };
  'debug/clear': { req: void; res: DebugStatus };
  'queue/state': { req: void; res: QueueState };
  'queue/start': { req: { urls: string[] }; res: QueueState };
  'queue/pause': { req: void; res: QueueState };
  'queue/resume': { req: void; res: QueueState };
  'queue/cancel': { req: void; res: QueueState };
  'queue/clear': { req: void; res: QueueState };
  'job/started': { req: { itemId: string }; res: void };
  'job/comments': {
    req: { itemId: string; records: CommentRecord[]; expectedTotal: number | null };
    res: void;
  };
  'job/finished': {
    req: {
      itemId: string;
      outcome: JobOutcome;
      message: string | null;
      blockCode: BlockCode | null;
      expectedTotal: number | null;
    };
    res: void;
  };
}

/** Broadcast: background thông báo cho side panel, không có response. */
export interface BroadcastMap {
  'debug/status': DebugStatus;
  'settings/changed': Settings;
  'queue/state': QueueState;
}

export type RequestType = keyof RequestMap;
export type BroadcastType = keyof BroadcastMap;

export const CHANNEL = 'sce';

export interface RequestEnvelope<K extends RequestType = RequestType> {
  channel: typeof CHANNEL;
  kind: 'request';
  type: K;
  payload: RequestMap[K]['req'];
}

export interface BroadcastEnvelope<K extends BroadcastType = BroadcastType> {
  channel: typeof CHANNEL;
  kind: 'broadcast';
  type: K;
  payload: BroadcastMap[K];
}

export type ResponseEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };
