import { browser } from 'wxt/browser';
import { getAllAdapters } from '@/adapters/registry';

const INTERCEPTOR_ID = 'sce-interceptor';
const CONTENT_ID = 'sce-content';

/** Đường dẫn file do WXT build ra (xem dist/chrome-mv3). */
const INTERCEPTOR_FILE = 'interceptor.js';
const CONTENT_FILE = 'content-scripts/content.js';

/**
 * Đăng ký động interceptor (MAIN world) + content script, chỉ khi đang có tab thu thập.
 * Nhờ vậy khi extension rảnh, các trang mạng xã hội hoàn toàn không bị chèn script.
 */
export async function ensureCaptureScriptsRegistered(): Promise<void> {
  const matches = [...new Set(getAllAdapters().flatMap((a) => a.contentScriptMatches))];
  const existing = await browser.scripting.getRegisteredContentScripts({
    ids: [INTERCEPTOR_ID, CONTENT_ID],
  });
  const have = new Set(existing.map((s) => s.id));
  const toRegister: Parameters<typeof browser.scripting.registerContentScripts>[0] = [];
  if (!have.has(INTERCEPTOR_ID)) {
    toRegister.push({
      id: INTERCEPTOR_ID,
      js: [INTERCEPTOR_FILE],
      matches,
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: false,
      persistAcrossSessions: false,
    });
  }
  if (!have.has(CONTENT_ID)) {
    toRegister.push({
      id: CONTENT_ID,
      js: [CONTENT_FILE],
      matches,
      runAt: 'document_start',
      world: 'ISOLATED',
      allFrames: false,
      persistAcrossSessions: false,
    });
  }
  if (toRegister.length) await browser.scripting.registerContentScripts(toRegister);
}

export async function unregisterCaptureScripts(): Promise<void> {
  const existing = await browser.scripting.getRegisteredContentScripts({
    ids: [INTERCEPTOR_ID, CONTENT_ID],
  });
  if (existing.length) {
    await browser.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  }
}
