import { useMemo, useState } from 'react';
import { parseLinkInput } from '@/core/queue/links';
import { usePanelStore } from '../store';
import { PlatformBadge } from './PlatformBadge';
import { card, primary } from './ui';

export function LinkInput({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState('');
  const busy = usePanelStore((s) => s.busy);
  const startQueue = usePanelStore((s) => s.startQueue);
  const hasData = usePanelStore((s) => s.queue.items.length > 0);
  const parsed = useMemo(() => parseLinkInput(text), [text]);
  const supported = parsed.links.filter((l) => l.supported);
  const unsupported = parsed.links.filter((l) => !l.supported);

  const start = () => {
    if (
      hasData &&
      !confirm('Chạy danh sách mới sẽ xóa dữ liệu của lần chạy trước. Bạn đã xuất Excel chưa?')
    ) {
      return;
    }
    void startQueue(parsed.links.map((l) => l.inputUrl));
  };

  return (
    <section className={card}>
      <h2 className="font-medium">1. Danh sách link bài viết</h2>
      <textarea
        className="h-32 w-full resize-y rounded-md border border-slate-300 p-2 font-mono text-xs"
        placeholder={
          'Mỗi dòng một link, ví dụ:\nhttps://www.facebook.com/.../posts/...\nhttps://www.facebook.com/reel/...'
        }
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
      />
      {text.trim() && (
        <div className="flex flex-col gap-1 text-xs">
          <p>
            <span className="font-medium text-emerald-700">{supported.length} link sẽ chạy</span>
            {unsupported.length > 0 && (
              <span className="text-slate-500">
                {' '}
                · {unsupported.length} link nền tảng chưa hỗ trợ (bỏ qua)
              </span>
            )}
          </p>
          {parsed.links.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {parsed.links.map((l) => (
                <PlatformBadge key={l.normalizedUrl} platform={l.platform} />
              ))}
            </div>
          )}
          {parsed.rejected.length > 0 && (
            <ul className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
              {parsed.rejected.map((r) => (
                <li key={r.line} className="truncate" title={r.text}>
                  Dòng {r.line}: {r.reason} — <span className="font-mono">{r.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        className={primary}
        disabled={disabled || busy || supported.length === 0}
        onClick={start}
      >
        Bắt đầu thu thập
      </button>
    </section>
  );
}
