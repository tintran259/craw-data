import { browser } from 'wxt/browser';
import { forEachDebugPayload, listDebugSessions } from '@/core/storage/debug-db';
import { fileTimestamp } from '@/shared/utils/time';

/**
 * Tạo file JSON debug. Ghi theo từng phần (Blob parts) để không phải giữ
 * một chuỗi JSON khổng lồ trong bộ nhớ.
 */
export async function buildDebugBlob(): Promise<{ blob: Blob; entryCount: number }> {
  const sessions = await listDebugSessions();
  const parts: string[] = [];
  const header = {
    format: 'social-comment-exporter/debug',
    version: 1,
    exportedAt: new Date().toISOString(),
    extensionVersion: browser.runtime.getManifest().version,
    note: 'Raw payload GraphQL và khối JSON nhúng trong HTML. Body request (token) không được lưu.',
    sessions,
  };
  const headerJson = JSON.stringify(header, null, 2);
  parts.push(headerJson.slice(0, -2), ',\n  "entries": [\n');
  let entryCount = 0;
  await forEachDebugPayload((p) => {
    const entry = {
      sessionId: p.sessionId,
      kind: p.kind,
      capturedAt: p.capturedAt,
      pageUrl: p.pageUrl,
      requestUrl: p.requestUrl,
      operationName: p.operationName,
      docId: p.docId,
      variables: p.variables,
      status: p.status,
      raw: p.raw,
    };
    parts.push(entryCount ? ',\n    ' : '    ', JSON.stringify(entry));
    entryCount++;
  });
  parts.push('\n  ]\n}\n');
  return { blob: new Blob(parts, { type: 'application/json' }), entryCount };
}

/** Chỉ gọi từ trang extension (side panel) vì cần URL.createObjectURL. */
export async function downloadDebugData(): Promise<number> {
  const { blob, entryCount } = await buildDebugBlob();
  if (!entryCount) throw new Error('Chưa có dữ liệu debug nào để tải.');
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({
      url,
      filename: `debug_${fileTimestamp()}.json`,
      saveAs: false,
    });
  } finally {
    // Đợi trình duyệt bắt đầu tải rồi mới thu hồi URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return entryCount;
}
