import { useState } from 'react';
import { formatDisplayTime } from '@/shared/utils/time';
import { usePanelStore } from '../store';

const btn =
  'rounded-md px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50 border';
const primary = `${btn} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;
const secondary = `${btn} border-slate-300 bg-white hover:bg-slate-100`;
const danger = `${btn} border-red-300 bg-white text-red-700 hover:bg-red-50`;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DebugPanel() {
  const [url, setUrl] = useState('');
  const debug = usePanelStore((s) => s.debug);
  const busy = usePanelStore((s) => s.busy);
  const startDebug = usePanelStore((s) => s.startDebug);
  const stopDebug = usePanelStore((s) => s.stopDebug);
  const clearDebug = usePanelStore((s) => s.clearDebug);
  const downloadDebug = usePanelStore((s) => s.downloadDebug);
  const active = debug.sessions.find((s) => s.id === debug.activeSessionId);
  const hasData = debug.sessions.some((s) => s.graphqlCount + s.htmlJsonCount > 0);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <h2 className="font-medium">Ghi dữ liệu debug</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void startDebug(url);
        }}
      >
        <input
          type="url"
          required
          placeholder="Dán link bài viết (Facebook, Instagram, Threads, X)"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className={primary} disabled={busy || !url.trim()}>
          Mở & ghi
        </button>
      </form>

      {active && (
        <div className="rounded-md border border-amber-300 bg-white p-2">
          <p className="font-medium text-amber-800">Đang ghi…</p>
          <p className="text-xs text-slate-600">
            Trong tab vừa mở, hãy tự: đổi bộ lọc sang “Tất cả bình luận”, bấm “Xem thêm bình luận”
            vài lần, mở vài nhánh “Xem … phản hồi”. Xong thì bấm “Dừng ghi”.
          </p>
          <button
            type="button"
            className={`${secondary} mt-2`}
            disabled={busy}
            onClick={() => void stopDebug()}
          >
            Dừng ghi
          </button>
        </div>
      )}

      {debug.sessions.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {debug.sessions.map((s) => (
            <li key={s.id} className="rounded border border-slate-200 bg-white p-2">
              <div className="truncate font-mono" title={s.postUrl}>
                {s.postUrl}
              </div>
              <div className="text-slate-600">
                GraphQL: {s.graphqlCount} · JSON trong HTML: {s.htmlJsonCount} (bỏ qua{' '}
                {s.skippedHtmlBlocks}) · {formatBytes(s.totalBytes)}
              </div>
              <div className="text-slate-400">
                {formatDisplayTime(s.startedAt)}
                {s.endedAt ? ` → ${formatDisplayTime(s.endedAt)}` : ' → đang ghi'}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          disabled={busy || !hasData}
          onClick={() => void downloadDebug()}
        >
          Tải dữ liệu debug
        </button>
        <button
          type="button"
          className={danger}
          disabled={busy || debug.sessions.length === 0}
          onClick={() => {
            if (confirm('Xóa toàn bộ dữ liệu debug đã ghi?')) void clearDebug();
          }}
        >
          Xóa dữ liệu debug
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Lưu ý: file debug chứa nội dung bình luận và tên người bình luận mà tài khoản của bạn xem
        được. Không chứa mật khẩu, cookie hay token.
      </p>
    </section>
  );
}
