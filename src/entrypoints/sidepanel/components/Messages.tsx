import { usePanelStore } from '../store';

export function Messages() {
  const error = usePanelStore((s) => s.error);
  const notice = usePanelStore((s) => s.notice);
  const dismiss = usePanelStore((s) => s.dismiss);
  if (!error && !notice) return null;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`flex items-start justify-between gap-2 rounded-md border p-2 ${
        error
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
    >
      <span>{error ?? notice}</span>
      <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={dismiss}>
        Đóng
      </button>
    </div>
  );
}
