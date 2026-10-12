import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, getSettings, sanitizeSettings, updateSettings } from './settings';

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('trả về mặc định khi chưa lưu', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('lưu và đọc lại', async () => {
    await updateSettings({ debugMode: true });
    expect((await getSettings()).debugMode).toBe(true);
  });

  it('không cho phép bỏ qua delay', () => {
    const s = sanitizeSettings({ actionDelayMs: { min: 0, max: 0 }, maxPostsPerHour: 0 });
    expect(s.actionDelayMs.min).toBeGreaterThanOrEqual(500);
    expect(s.maxPostsPerHour).toBe(1);
  });
});
