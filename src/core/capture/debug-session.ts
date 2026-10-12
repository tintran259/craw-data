import { browser } from 'wxt/browser';
import { findAdapterForUrl } from '@/adapters/registry';
import type { Platform } from '@/adapters/types';
import { broadcast, type CapturedPayload, type DebugStatus } from '@/core/messaging';
import {
  addDebugPayloads,
  clearDebugData,
  getDebugSession,
  listDebugSessions,
  putDebugSession,
} from '@/core/storage/debug-db';
import { getSettings } from '@/core/storage/settings';
import { getTabMode, hasAnyTabMode, removeTabMode, setTabMode } from '@/core/storage/tab-modes';
import { safeParseUrl } from '@/shared/url';
import { ensureCaptureScriptsRegistered, unregisterCaptureScripts } from './register-scripts';

const ACTIVE_KEY = 'debugActiveSessionId';

async function getActiveSessionId(): Promise<string | null> {
  const stored = await browser.storage.local.get(ACTIVE_KEY);
  return (stored[ACTIVE_KEY] as string | undefined) ?? null;
}

export async function getDebugStatus(): Promise<DebugStatus> {
  return { activeSessionId: await getActiveSessionId(), sessions: await listDebugSessions() };
}

async function publishStatus(): Promise<DebugStatus> {
  const status = await getDebugStatus();
  broadcast('debug/status', status);
  return status;
}

export async function startDebugSession(url: string): Promise<DebugStatus> {
  const settings = await getSettings();
  if (!settings.debugMode) throw new Error('Hãy bật Debug mode trước.');
  const trimmed = url.trim();
  const adapter = findAdapterForUrl(trimmed);
  if (!adapter) {
    throw new Error('Link không hợp lệ hoặc không phải link bài viết Facebook được hỗ trợ.');
  }
  const target = safeParseUrl(trimmed)?.toString() ?? trimmed;

  await stopDebugSession();
  await ensureCaptureScriptsRegistered();

  // Mở about:blank trước, gán chế độ cho tab, rồi mới điều hướng — tránh race khi
  // content script hỏi chế độ trước lúc background kịp ghi.
  const tab = await browser.tabs.create({ url: 'about:blank', active: true });
  if (tab.id === undefined) throw new Error('Không mở được tab mới.');

  const sessionId = await createDebugSession(tab.id, target, adapter.id);
  await setTabMode(tab.id, {
    platform: adapter.id,
    postUrl: target,
    purpose: 'debug',
    debugSessionId: sessionId,
    job: null,
  });
  await browser.storage.local.set({ [ACTIVE_KEY]: sessionId });
  await browser.tabs.update(tab.id, { url: target });
  return publishStatus();
}

/** Tạo phiên debug cho một tab (dùng cả cho phiên thủ công và cho từng bài trong hàng đợi). */
export async function createDebugSession(
  tabId: number,
  postUrl: string,
  platform: Platform,
): Promise<string> {
  const id = crypto.randomUUID();
  await putDebugSession({
    id,
    postUrl,
    platform,
    tabId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    graphqlCount: 0,
    htmlJsonCount: 0,
    skippedHtmlBlocks: 0,
    totalBytes: 0,
  });
  return id;
}

export async function endDebugSession(id: string): Promise<void> {
  const session = await getDebugSession(id);
  if (session && !session.endedAt) {
    await putDebugSession({ ...session, endedAt: new Date().toISOString() });
    await publishStatus();
  }
}

export async function stopDebugSession(): Promise<DebugStatus> {
  const activeId = await getActiveSessionId();
  if (activeId) {
    const session = await getDebugSession(activeId);
    if (session) {
      if (session.tabId !== null) await removeTabMode(session.tabId);
      await putDebugSession({ ...session, endedAt: new Date().toISOString() });
    }
    await browser.storage.local.remove(ACTIVE_KEY);
  }
  if (!(await hasAnyTabMode())) await unregisterCaptureScripts();
  return publishStatus();
}

export async function clearDebugSessions(): Promise<DebugStatus> {
  await stopDebugSession();
  await clearDebugData();
  return publishStatus();
}

export async function recordPayloads(
  tabId: number | undefined,
  payloads: CapturedPayload[],
  skippedHtmlBlocks = 0,
): Promise<void> {
  if (tabId === undefined) return;
  const mode = await getTabMode(tabId);
  if (!mode?.debugSessionId) return;
  const settings = await getSettings();
  if (!settings.debugMode) return;
  const updated = await addDebugPayloads(mode.debugSessionId, payloads, skippedHtmlBlocks);
  if (updated) await publishStatus();
}

/** Tab thu thập bị đóng: kết thúc phiên debug tương ứng. */
export async function handleTabRemoved(tabId: number): Promise<void> {
  const mode = await getTabMode(tabId);
  if (!mode) return;
  if (mode.purpose === 'debug' && mode.debugSessionId === (await getActiveSessionId())) {
    await stopDebugSession();
  }
  // Tab của hàng đợi do core/queue/runner xử lý.
}
