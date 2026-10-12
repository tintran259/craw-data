import { create } from 'zustand';
import { downloadDebugData } from '@/core/export/debug-export';
import { exportQueue } from '@/core/export/download';
import { sendRequest, type DebugStatus } from '@/core/messaging';
import { EMPTY_QUEUE, type QueueState } from '@/core/queue/types';
import type { Settings } from '@/core/storage/settings';
import { toUserMessage } from '@/shared/errors';

interface PanelState {
  settings: Settings | null;
  debug: DebugStatus;
  queue: QueueState;
  busy: boolean;
  error: string | null;
  notice: string | null;
  init(): Promise<void>;
  setSettings(s: Settings): void;
  setDebugStatus(s: DebugStatus): void;
  setQueue(s: QueueState): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  startQueue(urls: string[]): Promise<void>;
  pauseQueue(): Promise<void>;
  resumeQueue(): Promise<void>;
  cancelQueue(): Promise<void>;
  clearQueue(): Promise<void>;
  exportData(format: 'xlsx' | 'csv'): Promise<void>;
  startDebug(url: string): Promise<void>;
  stopDebug(): Promise<void>;
  clearDebug(): Promise<void>;
  downloadDebug(): Promise<void>;
  dismiss(): void;
}

export const usePanelStore = create<PanelState>((set, get) => {
  /** Chạy một thao tác, bắt mọi lỗi và hiển thị bằng tiếng Việt. */
  const run = async (action: () => Promise<void>) => {
    if (get().busy) return;
    set({ busy: true, error: null, notice: null });
    try {
      await action();
    } catch (err) {
      set({ error: toUserMessage(err) });
    } finally {
      set({ busy: false });
    }
  };

  return {
    settings: null,
    debug: { activeSessionId: null, sessions: [] },
    queue: EMPTY_QUEUE,
    busy: false,
    error: null,
    notice: null,
    init: () =>
      run(async () => {
        const [settings, debug, queue] = await Promise.all([
          sendRequest('settings/get'),
          sendRequest('debug/status'),
          sendRequest('queue/state'),
        ]);
        set({ settings, debug, queue });
      }),
    setSettings: (settings) => set({ settings }),
    setDebugStatus: (debug) => set({ debug }),
    setQueue: (queue) => set({ queue }),
    updateSettings: (patch) =>
      run(async () => {
        set({ settings: await sendRequest('settings/update', patch), notice: 'Đã lưu cài đặt.' });
      }),
    startQueue: (urls) =>
      run(async () => set({ queue: await sendRequest('queue/start', { urls }) })),
    pauseQueue: () => run(async () => set({ queue: await sendRequest('queue/pause') })),
    resumeQueue: () => run(async () => set({ queue: await sendRequest('queue/resume') })),
    cancelQueue: () => run(async () => set({ queue: await sendRequest('queue/cancel') })),
    clearQueue: () =>
      run(async () => set({ queue: await sendRequest('queue/clear'), notice: 'Đã xóa dữ liệu.' })),
    exportData: (format) =>
      run(async () => {
        const total = await exportQueue(get().queue, format);
        set({
          notice: `Đã xuất ${total} bình luận ra file ${format === 'xlsx' ? 'Excel' : 'CSV'}.`,
        });
      }),
    startDebug: (url) =>
      run(async () => {
        set({ debug: await sendRequest('debug/start', { url }) });
        set({ notice: 'Đã mở bài viết trong tab mới và bắt đầu ghi dữ liệu debug.' });
      }),
    stopDebug: () => run(async () => set({ debug: await sendRequest('debug/stop') })),
    clearDebug: () =>
      run(async () => {
        set({ debug: await sendRequest('debug/clear'), notice: 'Đã xóa dữ liệu debug.' });
      }),
    downloadDebug: () =>
      run(async () => {
        const count = await downloadDebugData();
        set({ notice: `Đã tải file debug gồm ${count} mục.` });
      }),
    dismiss: () => set({ error: null, notice: null }),
  };
});
