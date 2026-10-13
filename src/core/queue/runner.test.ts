import { describe, expect, it } from 'vitest';
import { windowBounds } from './runner';
import { migrateQueue } from './store';

describe('windowBounds', () => {
  const area = { left: 0, top: 0, width: 1920, height: 1040 };
  it('một bài: cửa sổ cỡ cố định', () => {
    expect(windowBounds(0, 1, area)).toEqual({ width: 1200, height: 900 });
    expect(windowBounds(0, 2, null)).toEqual({ width: 1200, height: 900 });
  });
  it('nhiều bài: chia lưới không chồng nhau', () => {
    expect([0, 1].map((s) => windowBounds(s, 2, area))).toEqual([
      { left: 0, top: 0, width: 960, height: 1040 },
      { left: 960, top: 0, width: 960, height: 1040 },
    ]);
    expect(windowBounds(3, 4, area)).toEqual({ left: 960, top: 520, width: 960, height: 520 });
  });
});

describe('migrateQueue', () => {
  it('chuyển hàng đợi bản cũ (một cửa sổ) sang danh sách cửa sổ', () => {
    const state = migrateQueue({
      status: 'running',
      items: [],
      workerTabId: 5,
      workerWindowId: 7,
      currentItemId: 'a',
      currentDebugSessionId: null,
    } as never);
    expect(state.workers).toEqual([
      { tabId: 5, windowId: 7, slot: 0, itemId: 'a', debugSessionId: null },
    ]);
    expect(state).not.toHaveProperty('workerTabId');
  });
  it('hàng đợi mới giữ nguyên', () => {
    expect(migrateQueue({}).workers).toEqual([]);
  });
});
