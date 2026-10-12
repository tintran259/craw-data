import { useState } from 'react';
import type { Settings } from '@/core/storage/settings';
import { usePanelStore } from '../store';
import { input, secondary } from './ui';

interface Form {
  actionMin: number;
  actionMax: number;
  postMin: number;
  postMax: number;
  maxPostsPerHour: number;
  timeoutMin: number;
  includeReplies: boolean;
}

const toForm = (s: Settings): Form => ({
  actionMin: s.actionDelayMs.min / 1000,
  actionMax: s.actionDelayMs.max / 1000,
  postMin: s.postDelayMs.min / 1000,
  postMax: s.postDelayMs.max / 1000,
  maxPostsPerHour: s.maxPostsPerHour,
  timeoutMin: s.postTimeoutMs / 60000,
  includeReplies: s.includeReplies,
});

function NumberField(props: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-slate-600">{props.label}</span>
      <input
        type="number"
        min={0}
        step={props.step ?? 1}
        className={input}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function SettingsPanel() {
  const settings = usePanelStore((s) => s.settings);
  if (!settings) return null;
  // Đổi key khi cài đặt thay đổi (vd. sau khi lưu) để form nạp lại giá trị đã chuẩn hóa.
  return <SettingsForm key={JSON.stringify(settings)} settings={settings} />;
}

function SettingsForm({ settings }: { settings: Settings }) {
  const busy = usePanelStore((s) => s.busy);
  const updateSettings = usePanelStore((s) => s.updateSettings);
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const patch = (p: Partial<Form>) => setForm({ ...form, ...p });

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <summary className="cursor-pointer text-sm font-medium">Cài đặt</summary>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void updateSettings({
            actionDelayMs: { min: form.actionMin * 1000, max: form.actionMax * 1000 },
            postDelayMs: { min: form.postMin * 1000, max: form.postMax * 1000 },
            maxPostsPerHour: form.maxPostsPerHour,
            postTimeoutMs: form.timeoutMin * 60000,
            includeReplies: form.includeReplies,
          });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Trễ giữa thao tác: từ (giây)"
            step={0.5}
            value={form.actionMin}
            onChange={(v) => patch({ actionMin: v })}
          />
          <NumberField
            label="đến (giây)"
            step={0.5}
            value={form.actionMax}
            onChange={(v) => patch({ actionMax: v })}
          />
          <NumberField
            label="Nghỉ giữa các bài: từ (giây)"
            value={form.postMin}
            onChange={(v) => patch({ postMin: v })}
          />
          <NumberField
            label="đến (giây)"
            value={form.postMax}
            onChange={(v) => patch({ postMax: v })}
          />
          <NumberField
            label="Số bài tối đa mỗi giờ"
            value={form.maxPostsPerHour}
            onChange={(v) => patch({ maxPostsPerHour: v })}
          />
          <NumberField
            label="Timeout mỗi bài (phút)"
            value={form.timeoutMin}
            onChange={(v) => patch({ timeoutMin: v })}
          />
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.includeReplies}
            onChange={(e) => patch({ includeReplies: e.target.checked })}
          />
          Lấy cả phản hồi (reply)
        </label>
        <p className="text-slate-500">
          Giá trị quá nhỏ sẽ tự được nâng lên mức tối thiểu an toàn (thao tác ≥ 0,5 giây, nghỉ giữa
          bài ≥ 2 giây). Thay đổi áp dụng từ bài tiếp theo.
        </p>
        <button type="submit" className={secondary} disabled={busy}>
          Lưu cài đặt
        </button>
      </form>
      <label className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <span>
          <span className="font-medium">Debug mode</span>
          <span className="block text-slate-500">
            Lưu raw dữ liệu để phân tích khi parser không lấy được bình luận.
          </span>
        </span>
        <input
          type="checkbox"
          disabled={busy}
          checked={settings.debugMode}
          onChange={(e) => void updateSettings({ debugMode: e.target.checked })}
        />
      </label>
    </details>
  );
}
