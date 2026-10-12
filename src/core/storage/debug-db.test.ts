import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CapturedPayload, DebugSession } from '@/core/messaging/protocol';
import {
  addDebugPayloads,
  clearDebugData,
  forEachDebugPayload,
  listDebugSessions,
  putDebugSession,
} from './debug-db';

const session: DebugSession = {
  id: 's1',
  postUrl: 'https://www.facebook.com/a/posts/1',
  platform: 'facebook',
  tabId: 1,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
  graphqlCount: 0,
  htmlJsonCount: 0,
  skippedHtmlBlocks: 0,
  totalBytes: 0,
};

const payload = (kind: CapturedPayload['kind'], raw: string): CapturedPayload => ({
  kind,
  pageUrl: session.postUrl,
  requestUrl: null,
  operationName: null,
  docId: null,
  variables: null,
  status: 200,
  raw,
  capturedAt: '2026-01-01T00:00:01.000Z',
});

describe('debug-db', () => {
  it('lưu payload, cập nhật bộ đếm, duyệt và xóa', async () => {
    await putDebugSession(session);
    const updated = await addDebugPayloads(
      's1',
      [payload('graphql', 'abc'), payload('html-json', 'de')],
      3,
    );
    expect(updated).toMatchObject({
      graphqlCount: 1,
      htmlJsonCount: 1,
      skippedHtmlBlocks: 3,
      totalBytes: 5,
    });

    const seen: string[] = [];
    await forEachDebugPayload((p) => seen.push(p.raw));
    expect(seen).toEqual(['abc', 'de']);

    expect(await addDebugPayloads('missing', [payload('graphql', 'x')])).toBeUndefined();

    await clearDebugData();
    expect(await listDebugSessions()).toEqual([]);
  });
});
