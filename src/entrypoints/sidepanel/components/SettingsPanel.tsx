import { useState, type ReactNode } from 'react';
import type { ReplyDepth, Settings } from '@/core/storage/settings';
import { usePanelStore } from '../store';
import { input, secondary } from './ui';

/** Giá trị trên form: thời gian tính bằng giây/phút cho dễ nhập. */
interface Form {
  actionMin: number;
  actionMax: number;
  postMin: number;
  postMax: number;
  maxPostsPerHour: number;
  timeoutMin: number;
  parallelPosts: number;
  replyDepth: ReplyDepth;
  maxCommentsPerPost: number;
  onlyNewComments: boolean;
  fastMode: boolean;
  apiMin: number;
  apiMax: number;
  replyLanes: number;
  probeFeedLocation: boolean;
}

const toForm = (s: Settings): Form => ({
  actionMin: s.actionDelayMs.min / 1000,
  actionMax: s.actionDelayMs.max / 1000,
  postMin: s.postDelayMs.min / 1000,
  postMax: s.postDelayMs.max / 1000,
  maxPostsPerHour: s.maxPostsPerHour,
  timeoutMin: s.postTimeoutMs / 60000,
  parallelPosts: s.parallelPosts,
  replyDepth: s.replyDepth,
  maxCommentsPerPost: s.maxCommentsPerPost,
  onlyNewComments: s.onlyNewComments,
  fastMode: s.fastMode,
  apiMin: s.apiDelayMs.min / 1000,
  apiMax: s.apiDelayMs.max / 1000,
  replyLanes: s.replyLanes,
  probeFeedLocation: s.probeFeedLocation,
});

const toSettings = (f: Form): Partial<Settings> => ({
  actionDelayMs: { min: f.actionMin * 1000, max: f.actionMax * 1000 },
  postDelayMs: { min: f.postMin * 1000, max: f.postMax * 1000 },
  maxPostsPerHour: f.maxPostsPerHour,
  postTimeoutMs: f.timeoutMin * 60000,
  parallelPosts: f.parallelPosts,
  replyDepth: f.replyDepth,
  maxCommentsPerPost: f.maxCommentsPerPost,
  onlyNewComments: f.onlyNewComments,
  fastMode: f.fastMode,
  apiDelayMs: { min: f.apiMin * 1000, max: f.apiMax * 1000 },
  replyLanes: f.replyLanes,
  probeFeedLocation: f.probeFeedLocation,
});

const REPLY_OPTIONS: { value: ReplyDepth; label: string }[] = [
  { value: 0, label: 'Không lấy reply (nhanh nhất)' },
  { value: 1, label: 'Reply của bình luận gốc' },
  { value: 2, label: 'Tất cả các cấp reply' },
];

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

function CheckField(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.children}</span>
    </label>
  );
}

function Group(props: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2 border-t border-slate-100 pt-2">
      <legend className="pr-2 font-medium text-slate-700">{props.title}</legend>
      {props.children}
    </fieldset>
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
          void updateSettings(toSettings(form));
        }}
      >
        <Group title="Tốc độ">
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
            <NumberField
              label="Số bài chạy cùng lúc (1–4)"
              value={form.parallelPosts}
              onChange={(v) => patch({ parallelPosts: v })}
            />
          </div>
          <p className="text-slate-500">
            Chạy nhiều bài cùng lúc mở nhiều cửa sổ xếp cạnh nhau — đừng che kín hay thu nhỏ chúng.
            Càng nhiều bài cùng lúc càng dễ bị nền tảng tạm giới hạn.
          </p>
        </Group>

        <Group title="Phạm vi">
          <label className="flex flex-col gap-0.5">
            <span className="text-slate-600">Lấy reply</span>
            <select
              className={input}
              value={form.replyDepth}
              onChange={(e) => patch({ replyDepth: Number(e.target.value) as ReplyDepth })}
            >
              {REPLY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Tối đa bình luận mỗi bài (0 = lấy hết)"
            value={form.maxCommentsPerPost}
            onChange={(v) => patch({ maxCommentsPerPost: v })}
          />
          <CheckField
            checked={form.onlyNewComments}
            onChange={(v) => patch({ onlyNewComments: v })}
          >
            Chỉ lấy bình luận mới so với lần chạy trước của cùng bài (Facebook, chế độ nhanh).
            <span className="block text-slate-500">
              Sắp theo &quot;Mới nhất&quot; và dừng ở bình luận đã lấy lần trước. Reply mới dưới
              bình luận cũ sẽ không được lấy.
            </span>
          </CheckField>
        </Group>

        <Group title="Chế độ nhanh — Facebook, Instagram, Threads">
          <CheckField checked={form.fastMode} onChange={(v) => patch({ fastMode: v })}>
            Gọi thẳng API phân trang thay vì bấm nút
          </CheckField>
          {form.fastMode && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Trễ giữa request API: từ (giây)"
                  step={0.1}
                  value={form.apiMin}
                  onChange={(v) => patch({ apiMin: v })}
                />
                <NumberField
                  label="đến (giây)"
                  step={0.1}
                  value={form.apiMax}
                  onChange={(v) => patch({ apiMax: v })}
                />
                <NumberField
                  label="Số luồng tải reply (1–4)"
                  value={form.replyLanes}
                  onChange={(v) => patch({ replyLanes: v })}
                />
              </div>
              <CheckField
                checked={form.probeFeedLocation}
                onChange={(v) => patch({ probeFeedLocation: v })}
              >
                Thử nghiệm (Facebook): dò feedLocation để tìm trang lớn hơn 10 bình luận.
                <span className="block text-amber-700">
                  Chưa được kiểm chứng — có thể bỏ sót bình luận. Chỉ bật để thử.
                </span>
              </CheckField>
            </>
          )}
          <p className="text-slate-500">
            Bình luận gốc luôn tải tuần tự (mỗi request chỉ được 4–15 bình luận tùy nền tảng); reply
            tải song song bằng các luồng riêng. Mỗi luồng nghỉ theo &quot;Trễ giữa request API&quot;
            — trễ càng nhỏ, luồng càng nhiều thì càng dễ bị tạm giới hạn (Instagram và Threads chặt
            hơn Facebook). Nền tảng từ chối API thì tự quay về bấm nút / cuộn. Threads chỉ tiếp quản
            sau khi trang tự tải thêm một lần.
          </p>
        </Group>

        <p className="text-slate-500">
          Sau mỗi lần bấm tải thêm, nếu trang trả dữ liệu sớm thì chỉ nghỉ thêm 0,3–0,9 giây;
          &quot;Trễ giữa thao tác&quot; là thời gian chờ tối đa khi chưa có dữ liệu. Giá trị quá nhỏ
          sẽ tự được nâng lên mức tối thiểu an toàn. Thay đổi áp dụng từ bài tiếp theo.
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
