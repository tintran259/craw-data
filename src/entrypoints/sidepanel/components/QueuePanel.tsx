import { useEffect, useState } from 'react';
import { ITEM_STATUS_LABEL, type ItemStatus, type RunStatus } from '@/core/queue/types';
import { usePanelStore } from '../store';
import { PlatformBadge } from './PlatformBadge';
import { card, danger, primary, secondary } from './ui';

const RUN_LABEL: Record<RunStatus, string> = {
  idle: 'Chưa chạy',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  blocked: 'Bị Facebook hạn chế — đã dừng',
  cancelled: 'Đã hủy',
  completed: 'Hoàn tất',
};

const STATUS_STYLE: Record<ItemStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-800',
  done: 'bg-emerald-100 text-emerald-800',
  error: 'bg-red-100 text-red-800',
  skipped: 'bg-amber-100 text-amber-800',
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function formatWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} phút ${s % 60} giây` : `${s} giây`;
}

export function QueuePanel() {
  const queue = usePanelStore((s) => s.queue);
  const busy = usePanelStore((s) => s.busy);
  const pauseQueue = usePanelStore((s) => s.pauseQueue);
  const resumeQueue = usePanelStore((s) => s.resumeQueue);
  const cancelQueue = usePanelStore((s) => s.cancelQueue);
  const clearQueue = usePanelStore((s) => s.clearQueue);
  const exportData = usePanelStore((s) => s.exportData);
  const now = useNow(queue.nextRunAt !== null);

  if (!queue.items.length) return null;

  const active = ['running', 'paused', 'blocked'].includes(queue.status);
  const counts = queue.items.reduce(
    (acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }),
    {} as Partial<Record<ItemStatus, number>>,
  );
  const totalComments = queue.items.reduce((s, i) => s + i.rootCount + i.replyCount, 0);
  const finished = (counts.done ?? 0) + (counts.error ?? 0) + (counts.skipped ?? 0);

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">2. Tiến độ</h2>
        <span className="text-xs font-medium text-slate-600">{RUN_LABEL[queue.status]}</span>
      </div>

      <div className="h-2 overflow-hidden rounded bg-slate-100">
        <div
          className="h-full bg-blue-600 transition-all"
          style={{ width: `${(finished / queue.items.length) * 100}%` }}
        />
      </div>
      <p className="text-xs text-slate-600">
        {finished}/{queue.items.length} link · {totalComments} bình luận
        {counts.error ? ` · ${counts.error} lỗi` : ''}
      </p>

      {queue.status === 'running' && queue.waitReason && queue.nextRunAt && (
        <p className="text-xs text-slate-500">
          {queue.waitReason}: bài tiếp theo sau {formatWait(queue.nextRunAt - now)}.
        </p>
      )}
      {queue.status === 'running' && queue.currentItemId && (
        <p className="text-xs text-slate-500">
          Đang thu thập trong cửa sổ riêng. Đừng thu nhỏ hay đóng cửa sổ đó (có thể làm việc ở cửa
          sổ khác).
        </p>
      )}
      {queue.message && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800"
        >
          {queue.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {queue.status === 'running' && (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => void pauseQueue()}
          >
            Tạm dừng
          </button>
        )}
        {(queue.status === 'paused' || queue.status === 'blocked') && (
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => void resumeQueue()}
          >
            Tiếp tục
          </button>
        )}
        {active && (
          <button
            type="button"
            className={danger}
            disabled={busy}
            onClick={() => {
              if (confirm('Hủy hàng đợi? Bình luận đã thu vẫn được giữ để xuất.'))
                void cancelQueue();
            }}
          >
            Hủy
          </button>
        )}
      </div>

      <ol className="flex max-h-[45vh] flex-col divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 text-xs">
        {queue.items.map((item, index) => (
          <li key={item.id} className="flex flex-col gap-1 p-2">
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-slate-400">{index + 1}</span>
              <PlatformBadge platform={item.platform} />
              <a
                className="min-w-0 flex-1 truncate font-mono text-slate-700 hover:underline"
                href={item.inputUrl}
                target="_blank"
                rel="noreferrer"
                title={item.inputUrl}
              >
                {item.inputUrl.replace(/^https?:\/\/(www\.)?/, '')}
              </a>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[item.status]}`}
              >
                {ITEM_STATUS_LABEL[item.status]}
              </span>
            </div>
            <div className="flex gap-3 pl-7 text-slate-600">
              <span>
                {item.rootCount + item.replyCount} bình luận ({item.rootCount} gốc,{' '}
                {item.replyCount} reply)
              </span>
              {item.expectedTotal !== null && <span>FB hiển thị: {item.expectedTotal}</span>}
            </div>
            {item.error && <p className="pl-7 text-red-700">{item.error}</p>}
          </li>
        ))}
      </ol>

      <h2 className="font-medium">3. Xuất dữ liệu</h2>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          disabled={busy || totalComments === 0}
          onClick={() => void exportData('xlsx')}
        >
          Xuất Excel
        </button>
        <button
          type="button"
          className={secondary}
          disabled={busy || totalComments === 0}
          onClick={() => void exportData('csv')}
        >
          Xuất CSV
        </button>
        <button
          type="button"
          className={danger}
          disabled={busy || active}
          title={active ? 'Hãy Hủy hàng đợi trước' : undefined}
          onClick={() => {
            if (confirm('Xóa toàn bộ danh sách và bình luận đã thu?')) void clearQueue();
          }}
        >
          Xóa dữ liệu
        </button>
      </div>
      {active && totalComments > 0 && (
        <p className="text-xs text-slate-500">Có thể xuất bất cứ lúc nào, kể cả khi đang chạy.</p>
      )}
    </section>
  );
}
