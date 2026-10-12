import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addDebugPayloads, putDebugSession } from '@/core/storage/debug-db';
import { buildDebugBlob } from './debug-export';

describe('buildDebugBlob', () => {
  it('tạo JSON hợp lệ chứa session và entries', async () => {
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      manifest_version: 3,
      name: 'x',
      version: '0.1.0',
    });
    await putDebugSession({
      id: 's',
      postUrl: 'https://www.facebook.com/a/posts/1',
      platform: 'facebook',
      tabId: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      graphqlCount: 0,
      htmlJsonCount: 0,
      skippedHtmlBlocks: 0,
      totalBytes: 0,
    });
    await addDebugPayloads('s', [
      {
        kind: 'graphql',
        pageUrl: 'p',
        requestUrl: 'https://www.facebook.com/api/graphql/',
        operationName: 'Q',
        docId: '1',
        variables: '{}',
        status: 200,
        raw: 'for (;;);{"a":"😀\\n"}',
        capturedAt: '2026-01-01T00:00:01.000Z',
      },
    ]);
    const { blob, entryCount } = await buildDebugBlob();
    expect(entryCount).toBe(1);
    const parsed = JSON.parse(await blob.text()) as {
      sessions: unknown[];
      entries: { operationName: string; raw: string }[];
    };
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ operationName: 'Q', raw: 'for (;;);{"a":"😀\\n"}' });
  });
});
