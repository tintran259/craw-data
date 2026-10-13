import { useEffect, useState } from 'react';
import {
  ITEM_STATUS_LABEL,
  type ItemStatus,
  type QueueItem,
  type RunStatus,
} from '@/core/queue/types';
import { formatDisplayTime, formatDuration } from '@/shared/utils/time';
import { usePanelStore } from '../store';
import { PlatformBadge } from './PlatformBadge';
import { card, danger, primary, secondary } from './ui';

const RUN_LABEL: Record<RunStatus, string> = {
  idle: 'Chưa chạy',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  blocked: 'Bị nền tảng hạn chế — đã dừng',
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

/** Ghi chú nhiều dòng: dòng cảnh báo tô cam, dòng kích thước trang in đậm. */
function NoteLines({ note }: { note: string }) {
  return (
    <div className="flex flex-col gap-0.5 pl-7">
      {note.split('\n').map((line, i) => (
        <p
          key={i}
          className={
            line.startsWith('Số bình luận mỗi trang')
              ? 'font-medium text-blue-700'
              : NOTE_WARNING.test(line)
                ? 'text-amber-700'
                : 'text-slate-500'
          }
        >
          {line}
        </p>
      ))}
    </div>
  );
}

/** Ghi chú có cảnh báo (bộ lọc chưa đúng, bị giới hạn, nút chưa nhận diện) thì tô màu cam. */
const NOTE_WARNING = /có thể thiếu|giới hạn tạm thời|chưa nhận diện/;

/**
 * % đã lấy so với số FB hiển thị, chỉ khi bài đã kết thúc và thấp hơn 80%.
 * (Số FB hiển thị thường gồm cả bình luận đã xóa/bị ẩn nên lệch ít là bình thường.)
 */
function lowCoverage(item: QueueItem): number | null {
  if (!item.expectedTotal || (item.status !== 'done' && item.status !== 'error')) return null;
  const ratio = (item.rootCount + item.replyCount) / item.expectedTotal;
  return ratio < 0.8 ? Math.round(ratio * 1000) / 10 : null;
}

/** Bài lỗi / bị hủy giữa chừng có thể chạy lại (bài nền tảng chưa hỗ trợ thì không). */
const canRetry = (item: QueueItem) =>
  item.status === 'error' || (item.status === 'skipped' && item.error === 'Đã hủy');

/** Thời gian chạy của một bài; bài đang chạy tính tới hiện tại. */
function itemDuration(item: QueueItem, now: number): number | null {
  if (!item.startedAt) return null;
  const end = item.finishedAt
    ? Date.parse(item.finishedAt)
    : item.status === 'running'
      ? now
      : null;
  return end === null ? null : end - Date.parse(item.startedAt);
}

export function QueuePanel() {
  const queue = usePanelStore((s) => s.queue);
  const busy = usePanelStore((s) => s.busy);
  const pauseQueue = usePanelStore((s) => s.pauseQueue);
  const resumeQueue = usePanelStore((s) => s.resumeQueue);
  const cancelQueue = usePanelStore((s) => s.cancelQueue);
  const clearQueue = usePanelStore((s) => s.clearQueue);
  const retryItem = usePanelStore((s) => s.retryItem);
  const exportData = usePanelStore((s) => s.exportData);
  const active = ['running', 'paused', 'blocked'].includes(queue.status);
  const now = useNow(active);

  if (!queue.items.length) return null;

  const counts = queue.items.reduce(
    (acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }),
    {} as Partial<Record<ItemStatus, number>>,
  );
  const totalComments = queue.items.reduce((s, i) => s + i.rootCount + i.replyCount, 0);
  const finished = (counts.done ?? 0) + (counts.error ?? 0) + (counts.skipped ?? 0);
  const runningWindows = queue.workers.filter((w) => w.itemId).length;

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
      {queue.startedAt !== null && (
        <p className="text-xs text-slate-600">
          Bắt đầu lúc {formatDisplayTime(new Date(queue.startedAt).toISOString())} · Tổng thời gian:{' '}
          {formatDuration((queue.finishedAt ?? now) - queue.startedAt)}
        </p>
      )}

      {queue.status === 'running' && queue.waitReason && queue.nextRunAt && (
        <p className="text-xs text-slate-500">
          {queue.waitReason}: bài tiếp theo sau{' '}
          {formatDuration(Math.ceil((queue.nextRunAt - now) / 1000) * 1000)}.
        </p>
      )}
      {queue.status === 'running' && runningWindows > 0 && (
        <p className="text-xs text-slate-500">
          Đang thu thập trong {runningWindows > 1 ? `${runningWindows} cửa sổ` : 'cửa sổ'} riêng.
          Đừng thu nhỏ, che kín hay đóng các cửa sổ đó.
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
            {itemDuration(item, now) !== null && (
              <div className="pl-7 text-slate-500">
                Thời gian: {formatDuration(itemDuration(item, now)!)}
              </div>
            )}
            {item.error && <p className="pl-7 text-red-700">{item.error}</p>}
            {lowCoverage(item) !== null && (
              <p className="pl-7 text-amber-700">
                Mới lấy được {lowCoverage(item)}% so với số FB hiển thị.
              </p>
            )}
            {item.note && <NoteLines note={item.note} />}
            {canRetry(item) && (
              <div className="pl-7">
                <button
                  type="button"
                  className={`${secondary} px-2 py-0.5`}
                  disabled={busy}
                  title={
                    item.hasCheckpoint
                      ? 'Tiếp tục từ chỗ dừng, giữ bình luận đã lấy'
                      : 'Chạy lại bài này, giữ bình luận đã lấy'
                  }
                  onClick={() => void retryItem(item.id)}
                >
                  {item.hasCheckpoint ? 'Chạy tiếp' : 'Chạy lại'}
                </button>
              </div>
            )}
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
