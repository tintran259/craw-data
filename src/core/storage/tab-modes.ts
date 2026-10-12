import { browser } from 'wxt/browser';
import type { TabMode } from '@/core/messaging/protocol';

/** Lưu trong storage.local để vẫn còn sau khi service worker bị tắt và khởi động lại. */
const KEY = 'tabModes';

type TabModes = Record<string, TabMode>;

async function readAll(): Promise<TabModes> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] as TabModes | undefined) ?? {};
}

export async function getTabMode(tabId: number): Promise<TabMode | null> {
  return (await readAll())[String(tabId)] ?? null;
}

export async function setTabMode(tabId: number, mode: TabMode): Promise<void> {
  const all = await readAll();
  all[String(tabId)] = mode;
  await browser.storage.local.set({ [KEY]: all });
}

export async function removeTabMode(tabId: number): Promise<TabMode | null> {
  const all = await readAll();
  const mode = all[String(tabId)] ?? null;
  if (mode) {
    delete all[String(tabId)];
    await browser.storage.local.set({ [KEY]: all });
  }
  return mode;
}

export async function hasAnyTabMode(): Promise<boolean> {
  return Object.keys(await readAll()).length > 0;
}
