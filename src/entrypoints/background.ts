import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  clearDebugSessions,
  getDebugStatus,
  handleTabRemoved,
  recordPayloads,
  startDebugSession,
  stopDebugSession,
} from '@/core/capture/debug-session';
import { broadcast, registerRequestHandlers } from '@/core/messaging';
import {
  cancelQueue,
  clearQueue,
  getQueueState,
  onJobCheckpoint,
  onJobComments,
  onJobFinished,
  onJobStarted,
  onQueueAlarm,
  onWorkerTabRemoved,
  pauseQueue,
  recoverQueue,
  resumeQueue,
  retryItem,
  startQueue,
} from '@/core/queue/runner';
import { getSettings, updateSettings } from '@/core/storage/settings';
import { getTabMode } from '@/core/storage/tab-modes';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('background');

export default defineBackground(() => {
  // Mọi listener phải được đăng ký đồng bộ ngay khi service worker khởi động.
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => log.error('Không bật được side panel', err));

  registerRequestHandlers({
    'settings/get': () => getSettings(),
    'settings/update': async (patch) => {
      const next = await updateSettings(patch);
      broadcast('settings/changed', next);
      if (!next.debugMode) await stopDebugSession();
      return next;
    },
    'tab/getMode': (_payload, sender) =>
      sender.tab?.id !== undefined && sender.frameId === 0 ? getTabMode(sender.tab.id) : null,
    'capture/payloads': ({ payloads, skippedHtmlBlocks }, sender) =>
      recordPayloads(sender.tab?.id, payloads, skippedHtmlBlocks),
    'debug/start': ({ url }) => startDebugSession(url),
    'debug/stop': () => stopDebugSession(),
    'debug/status': () => getDebugStatus(),
    'debug/clear': () => clearDebugSessions(),
    'queue/state': () => getQueueState(),
    'queue/start': ({ urls }) => startQueue(urls),
    'queue/pause': () => pauseQueue(),
    'queue/resume': () => resumeQueue(),
    'queue/cancel': () => cancelQueue(),
    'queue/clear': () => clearQueue(),
    'queue/retryItem': ({ itemId }) => retryItem(itemId),
    'job/started': ({ itemId }, sender) => onJobStarted(itemId, sender.tab?.id),
    'job/comments': ({ itemId, records, expectedTotal, note }, sender) =>
      onJobComments(itemId, records, expectedTotal, sender.tab?.id, note ?? null),
    'job/checkpoint': ({ itemId, state }, sender) => onJobCheckpoint(itemId, state, sender.tab?.id),
    'job/finished': (payload, sender) => onJobFinished(payload, sender.tab?.id),
    'util/sleep': ({ ms }) =>
      new Promise<void>((resolve) => setTimeout(resolve, Math.min(Math.max(ms, 0), 60_000))),
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    Promise.all([handleTabRemoved(tabId), onWorkerTabRemoved(tabId)]).catch((err: unknown) =>
      log.error('Lỗi khi đóng tab', err),
    );
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    onQueueAlarm(alarm.name).catch((err: unknown) => log.error('Lỗi alarm', err));
  });

  // Service worker có thể bị tắt bất cứ lúc nào: mỗi lần khởi động đều khôi phục hàng đợi.
  recoverQueue().catch((err: unknown) => log.error('Không khôi phục được hàng đợi', err));
});
