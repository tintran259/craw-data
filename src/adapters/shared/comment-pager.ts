import type { GraphqlCall, ObservedPayload } from '@/adapters/types';
import { get, isObj, str, type Json } from './json';
import { splitJsonPayload } from './payload-splitter';

/**
 * Lõi chung của "chế độ nhanh": tải bình luận bằng cách gọi thẳng query phân trang Relay GraphQL
 * mà chính trang dùng (Facebook, Instagram, Threads cùng nền của Meta). Lớp này chỉ giữ trạng thái
 * và lập request — không đụng DOM, không gọi mạng (xem api-runner).
 *
 * Mô hình chung: danh sách bình luận gốc là MỘT chuỗi cursor (chỉ một request tại một thời điểm);
 * mỗi bình luận có reply là một "nhánh" độc lập (chạy song song được). Lớp con cho biết: dữ liệu
 * nằm ở đâu trong payload, nhánh nhận diện thế nào, và biến của từng query.
 */

export interface Connection {
  edges: unknown[];
  endCursor: string | null;
  hasNext: boolean;
}

export function connectionOf(v: unknown): Connection | null {
  if (!isObj(v) || !Array.isArray(v.edges) || !isObj(v.page_info)) return null;
  return {
    edges: v.edges,
    endCursor: str(v.page_info.end_cursor),
    hasNext: v.page_info.has_next_page === true,
  };
}

/**
 * Số bình luận xin mỗi trang, thử từ lớn xuống nhỏ. Bị lỗi thì hạ một bậc; hết bậc thì để nền tảng
 * tự chọn. Nếu nền tảng nhận nhưng âm thầm trả ít hơn, hạ xuống bậc nhỏ nhất vẫn ≥ số thực nhận
 * (hoặc về mặc định nếu trần thấp hơn mọi bậc) để request trông bình thường.
 */
export const PAGE_SIZES = [1000, 500, 200, 100, 50] as const;

/** Lỗi liên tiếp của một loại query trước khi bỏ chế độ nhanh cho loại đó (quay về bấm nút). */
const MAX_FAILURES = 3;
/** Lỗi tạm thời (trang rỗng) liên tiếp được chờ rồi thử lại trước khi tính là lỗi thật. */
const MAX_TRANSIENT_RETRIES = 5;

export interface PlannedRequest extends GraphqlCall {
  /** `root` hoặc loại nhánh reply của nền tảng. */
  kind: string;
  /** Khóa nhánh reply; null với danh sách gốc. */
  threadId: string | null;
  /** Số bình luận đã xin; null = để nền tảng tự chọn. */
  pageSize: number | null;
  probe: string;
  /** Cursor trước request, để phát hiện nền tảng trả lại đúng trang cũ. */
  cursorBefore: string | null;
  /** Giá trị đang thử (vd. feedLocation của Facebook); null = bình thường. */
  trial: string | null;
  /** Dùng cursor / token khôi phục từ lần chạy trước. */
  resumed: boolean;
}

/** `backoff` = lỗi tạm thời: nghỉ lâu hơn bình thường rồi gửi lại đúng request đó. */
export type RequestOutcome = 'ok' | 'retry' | 'backoff' | 'disabled' | 'rate_limited';

/** Trạng thái lưu lại để lần chạy sau tiếp tục từ chỗ dừng (không lưu nhánh đã xong). */
export interface PagerSnapshot {
  v: 2;
  ownerId: string | null;
  rootCursor: string | null;
  rootHasNext: boolean;
  /** Biến học được từ trang (riêng từng nền tảng). */
  learned: Json;
  threads: { id: string; token: string | null; parentDepth: number; cursor: string | null }[];
}

export interface Thread {
  id: string;
  /** Token phụ để tải nhánh (Facebook: expansion_token); null nếu nền tảng không cần. */
  token: string | null;
  /** Độ sâu của comment cha: 0 = bình luận gốc. */
  parentDepth: number;
  cursor: string | null;
  done: boolean;
  /** Khôi phục từ lần chạy trước (token có thể đã hết hạn). */
  restored: boolean;
}

interface Probe {
  /** Bậc đang dùng trong PAGE_SIZES; bằng length = để nền tảng tự chọn. */
  index: number;
  /** Đã có response hợp lệ ở bậc hiện tại. */
  confirmed: boolean;
  /** Số bình luận nhiều nhất nhận được trong một trang chưa phải trang cuối. */
  maxSeen: number;
  requests: number;
}

export interface PagerOptions {
  replyDepth: 0 | 1 | 2;
  /** Chỉ lấy bình luận gốc mới hơn mốc này (giây Unix) — dừng khi gặp bình luận cũ hơn. */
  onlyNewerThan?: number | null;
}

function parseVariables(raw: string | null): Json | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

function hasError(values: unknown[], match: (e: Json) => boolean): boolean {
  return values.some(
    (v) => isObj(v) && Array.isArray(v.errors) && v.errors.some((e) => isObj(e) && match(e)),
  );
}

const RATE_LIMIT_TEXT = /rate limit|too many|please wait a few minutes|quá nhiều|tạm thời bị chặn/i;

function isRateLimited(status: number, values: unknown[]): boolean {
  if (status === 429) return true;
  // Instagram trả lỗi dạng {"message": "...", "status": "fail"} thay vì mảng errors.
  if (values.some((v) => RATE_LIMIT_TEXT.test(String(get(v, 'message') ?? '')))) return true;
  return hasError(
    values,
    (e) => e.code === 1675004 || RATE_LIMIT_TEXT.test(String(e.message ?? '')),
  );
}

/** 1675012: trang rỗng tạm thời — chờ rồi thử lại là được (theo kinh nghiệm fbgql). */
const isTransient = (values: unknown[]) => hasError(values, (e) => e.code === 1675012);

export abstract class CommentPager {
  // ---- Riêng từng nền tảng -----------------------------------------------------------------
  /** Query của từng loại trang: `root` + các loại nhánh reply (doc_id dự phòng). */
  protected abstract readonly ops: Record<string, { name: string; docId: string }>;
  /** Tên nền tảng trong ghi chú (vd. "Facebook"). */
  protected abstract readonly platformName: string;
  /** Nhãn hiển thị của từng loại trang. */
  protected abstract readonly labels: Record<string, string>;
  /** Tên phép thử nghiệm biến thể request gốc trong ghi chú. */
  protected trialName = 'Thử nghiệm';
  /** Chuỗi đặc trưng: payload không chứa chuỗi nào thì bỏ qua nhanh. */
  protected abstract readonly markers: string[];
  /** Payload từ query này có thể chứa danh sách gốc của bài (null = JSON nhúng trong HTML). */
  protected abstract isRootSource(operationName: string | null): boolean;
  /** Danh sách gốc trong payload: chủ sở hữu (id bài, nếu biết) + connection. */
  protected abstract findRootList(
    values: unknown[],
  ): { ownerId: string | null; conn: Connection } | null;
  /** Danh sách reply trong response của một request nhánh. */
  protected abstract findThreadList(values: unknown[]): Connection | null;
  /** Thu nhánh reply (gọi `addThread`) và thông tin bài từ một payload. */
  protected abstract scanPayload(values: unknown[]): void;
  /** Nhánh mà một request (của trang hoặc của pager) với biến này đang tải. */
  protected abstract threadOfRequest(
    kind: string,
    vars: Json,
  ): { id: string; token: string | null; parentDepth: number } | null;
  /** Loại query dùng để tải nhánh này. */
  protected abstract threadKind(t: Thread): string;
  protected abstract rootVariables(
    cursor: string,
    count: number | null,
    trial: string | null,
  ): Json;
  protected abstract threadVariables(t: Thread, count: number | null): Json;
  /** Học biến (relay providers, id bài...) từ request do chính trang gửi. */
  protected abstract learnVariables(operationName: string, vars: Json): void;
  /** Biến học được, lưu kèm checkpoint. */
  protected abstract learnedState(): Json;
  protected abstract restoreLearned(state: Json): void;

  /** Đủ thông tin để tự gọi trang gốc kế tiếp (vd. Instagram cần media id). */
  protected rootReady(): boolean {
    return !!this.rootOwnerId;
  }
  /** Payload (không phải response query bình luận) có đáng đọc không. */
  protected isRelevant(raw: string): boolean {
    return this.markers.some((m) => raw.includes(m));
  }
  /** Đủ thông tin để tự gọi loại nhánh này (vd. Threads cần học biến từ request của trang). */
  protected kindReady(_kind: string): boolean {
    return true;
  }
  /** Query loại này có tham số số lượng để dò kích thước trang không. */
  protected sizeable(_kind: string): boolean {
    return true;
  }
  /** Danh sách gốc này có thuộc bài đang thu thập không. */
  protected ownerMatches(_ownerId: string | null): boolean {
    return true;
  }
  /** count khi không xin trang lớn (mặc định của nền tảng). */
  protected defaultCount(_kind: string, first: boolean): number | null {
    return first ? null : -1;
  }
  /** Các loại nhánh cần cho số cấp reply đã chọn. */
  protected threadKindsFor(_replyDepth: 1 | 2): string[] {
    return Object.keys(this.ops).filter((k) => k !== 'root');
  }
  /** Thời điểm tạo (giây) của bình luận cũ nhất trong một trang gốc — null nếu không hỗ trợ. */
  protected oldestCreatedTime(_edges: unknown[]): number | null {
    return null;
  }
  /** Thử nghiệm biến thể của request gốc: giá trị đang dùng + áp dụng giá trị thắng. */
  protected trialBaseline(): string | null {
    return null;
  }
  protected applyTrialWinner(_value: string): void {}

  // ---- Trạng thái chung --------------------------------------------------------------------
  protected readonly replyDepth: 0 | 1 | 2;
  protected readonly onlyNewerThan: number | null;
  protected rootOwnerId: string | null = null;
  private rootCursor: string | null = null;
  private rootHasNext = false;
  private rootSeen = false;
  private rootInFlight = false;
  /**
   * Chuỗi gốc khôi phục từ lần trước: `pending` = chưa biết cursor cũ còn dùng được không,
   * `confirmed` = đã dùng được. Khi đang khôi phục, danh sách trang tự tải (từ đầu) chỉ được
   * ghi nhớ làm phương án dự phòng chứ không ghi đè cursor.
   */
  private resumedRoot: 'none' | 'pending' | 'confirmed' = 'none';
  private pageRoot: { cursor: string | null; hasNext: boolean } | null = null;
  /** Đã gặp bình luận không mới hơn mốc `onlyNewerThan`. */
  private reachedKnown = false;
  /** Số lần trang tự tải danh sách gốc (vd. sau khi đổi bộ lọc). */
  private pageRootLists = 0;
  private docIdOverrides: Record<string, string> = {};
  private readonly threads = new Map<string, Thread>();
  /** Thứ tự phát hiện nhánh reply; `threadIndex` trỏ tới nhánh đầu tiên có thể chưa xong. */
  private readonly threadOrder: Thread[] = [];
  private threadIndex = 0;
  private readonly inFlightThreads = new Set<string>();
  private readonly disabled: Record<string, boolean> = {};
  private readonly failures: Record<string, number> = {};
  private readonly probes = new Map<string, Probe>();
  private transientRetries = 0;
  /** Thử nghiệm: các giá trị còn phải thử và số bình luận mỗi trang của từng giá trị. */
  protected trials: string[] = [];
  private readonly trialResults = new Map<string, number>();
  private trialSummary: string | null = null;
  private readonly stats = {
    requests: {} as Record<string, number>,
    rootComments: 0,
    errors: 0,
    skippedThreads: 0,
    resumeFailed: false,
  };
  private waiters: (() => void)[] = [];

  constructor(options: PagerOptions) {
    this.replyDepth = options.replyDepth;
    this.onlyNewerThan = options.onlyNewerThan ?? null;
  }

  private kindOf(name: string | null): string | null {
    return Object.keys(this.ops).find((k) => this.ops[k]!.name === name) ?? null;
  }

  /** Học trạng thái từ MỌI payload (của trang hoặc của chính pager). */
  observe(p: ObservedPayload): void {
    const kind = this.kindOf(p.operationName);
    if (kind && p.docId) this.docIdOverrides[kind] = p.docId;
    const vars = parseVariables(p.variables);
    // Chỉ học biến từ request của chính trang (request của pager mang giá trị pager tự đặt).
    if (vars && p.source !== 'api' && p.operationName) this.learnVariables(p.operationName, vars);
    // Bỏ nhanh payload không liên quan — trừ response của query bình luận (trang cuối có thể rỗng
    // nhưng vẫn cho biết nhánh đã xong).
    if (kind === null && !this.isRelevant(p.raw)) return;

    const values = splitJsonPayload(p.raw);
    const root = this.isRootSource(p.operationName) ? this.findRootList(values) : null;
    if (
      root &&
      this.ownerMatches(root.ownerId) &&
      (!this.rootOwnerId || !root.ownerId || root.ownerId === this.rootOwnerId)
    ) {
      this.rootOwnerId ??= root.ownerId;
      this.rootSeen = true;
      if (p.source !== 'api') this.pageRootLists++;
      const hasNext = root.conn.hasNext && !!root.conn.endCursor;
      if (this.resumedRoot !== 'none' && p.source !== 'api') {
        // Trang tự tải lại từ đầu: giữ cursor khôi phục, chỉ nhớ trang đầu làm phương án dự phòng.
        this.pageRoot = { cursor: root.conn.endCursor, hasNext };
      } else {
        this.rootCursor = root.conn.endCursor;
        this.rootHasNext = hasNext;
        this.applyOnlyNewer(root.conn.edges);
      }
    }
    if (kind && kind !== 'root' && vars) {
      const conn = this.findThreadList(values);
      const ref = this.threadOfRequest(kind, vars);
      if (conn && ref) {
        const thread = this.addThread(ref.id, ref.token, ref.parentDepth);
        thread.cursor = conn.endCursor;
        thread.done = !conn.hasNext || !conn.endCursor;
      }
    }
    this.scanPayload(values);
    this.notify();
  }

  /** Số lần trang tự tải danh sách gốc — để chờ danh sách mới sau khi đổi bộ lọc. */
  pageRootListsSeen(): number {
    return this.pageRootLists;
  }

  /** Có đang tự lo loại trang này không (để phần bấm nút không bấm trùng). */
  handles(kind: string): boolean {
    if (this.disabled[kind]) return false;
    return kind === 'root' ? this.rootSeen && this.rootReady() : this.kindReady(kind);
  }

  /** Đang tự lo reply ở mọi cấp đã chọn (phần bấm nút khỏi bấm "xem phản hồi"). */
  handlesReplies(): boolean {
    const depth = this.replyDepth;
    return depth > 0 && this.threadKindsFor(depth as 1 | 2).every((k) => this.handles(k));
  }

  /** Request trang gốc tiếp theo; null nếu đang có request gốc chạy hoặc đã hết. */
  takeRoot(): PlannedRequest | null {
    if (this.rootInFlight || !this.handles('root') || !this.rootHasNext || !this.rootCursor) {
      return null;
    }
    this.rootInFlight = true;
    const cursor = this.rootCursor;
    const trial = this.trials[0] ?? null;
    const resumed = this.resumedRoot === 'pending';
    return this.plan('root', null, cursor, false, resumed, trial, (count) =>
      this.rootVariables(cursor, count, trial),
    );
  }

  /** Request nhánh reply tiếp theo chưa có ai xử lý; null nếu không còn nhánh nào sẵn sàng. */
  takeThread(): PlannedRequest | null {
    const thread = this.pickThread();
    if (!thread) return null;
    this.inFlightThreads.add(thread.id);
    const kind = this.threadKind(thread);
    const first = thread.cursor === null;
    return this.plan(kind, thread.id, thread.cursor, first, thread.restored, null, (count) =>
      this.threadVariables(thread, count),
    );
  }

  /** Lần lượt: hết bình luận gốc rồi mới tới reply (dùng khi chạy tuần tự). */
  next(): PlannedRequest | null {
    return this.takeRoot() ?? this.takeThread();
  }

  /** Có request nào gửi được ngay không (không đánh dấu đang chạy). */
  hasWork(): boolean {
    const rootReady =
      !this.rootInFlight && this.handles('root') && this.rootHasNext && !!this.rootCursor;
    return rootReady || this.pickThread() !== null;
  }

  /** Còn việc có thể xuất hiện thêm (request đang chạy sẽ mang về trang / nhánh mới). */
  mayProduceWork(): boolean {
    return (
      this.rootInFlight ||
      this.inFlightThreads.size > 0 ||
      (this.handles('root') && this.rootHasNext)
    );
  }

  /** Đã tải hết bằng API: không cần bấm nút hay chờ thêm. */
  isComplete(): boolean {
    const depth = this.replyDepth;
    const repliesHandled =
      depth === 0 || this.threadKindsFor(depth).every((k) => !this.disabled[k]);
    return (
      this.handles('root') &&
      !this.rootHasNext &&
      repliesHandled &&
      !this.mayProduceWork() &&
      !this.hasPendingThreads()
    );
  }

  /** Promise xong khi trạng thái đổi (trang mới, nhánh mới, request xong). */
  changed(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Đánh thức mọi luồng đang chờ (vd. khi dừng giữa chừng). */
  notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  /**
   * Gọi SAU khi response của `req` đã được `observe`. Kiểm tra response hợp lệ và có tiến triển;
   * quyết định thử lại, bỏ trang lớn, hay tắt chế độ nhanh cho loại query này.
   */
  onResult(req: PlannedRequest, status: number, raw: string): RequestOutcome {
    if (req.kind === 'root') this.rootInFlight = false;
    else if (req.threadId) this.inFlightThreads.delete(req.threadId);
    try {
      return this.evaluate(req, status, raw);
    } finally {
      this.notify();
    }
  }

  private evaluate(req: PlannedRequest, status: number, raw: string): RequestOutcome {
    this.stats.requests[req.kind] = (this.stats.requests[req.kind] ?? 0) + 1;
    const values = raw ? splitJsonPayload(raw) : [];
    if (isRateLimited(status, values)) return 'rate_limited';
    if (status === 200 && isTransient(values) && this.transientRetries < MAX_TRANSIENT_RETRIES) {
      this.transientRetries++;
      this.stats.errors++;
      return 'backoff';
    }
    this.transientRetries = 0;
    const conn =
      status !== 200
        ? null
        : req.kind === 'root'
          ? (this.findRootList(values)?.conn ?? null)
          : this.findThreadList(values);
    const probe = this.probe(req.probe);
    probe.requests++;
    const ok = !!conn && (conn.endCursor !== req.cursorBefore || !conn.hasNext);
    if (req.trial) this.recordTrial(req.trial, ok ? conn!.edges.length : null);
    if (ok) {
      this.failures[req.kind] = 0;
      const thread = req.threadId ? this.threads.get(req.threadId) : undefined;
      if (thread) {
        thread.cursor = conn!.endCursor;
        thread.done = !conn!.hasNext || !conn!.endCursor;
      }
      if (req.kind === 'root') {
        if (req.resumed) this.resumedRoot = 'confirmed';
        this.stats.rootComments += conn!.edges.length;
        const baseline = this.trialBaseline();
        if (!req.trial && baseline && !this.trialResults.has(baseline)) {
          this.trialResults.set(baseline, conn!.edges.length);
        }
      }
      if (req.pageSize !== null) this.learnPageSize(probe, req.pageSize, conn!);
      return 'ok';
    }
    this.stats.errors++;
    if (req.trial) return 'retry'; // giá trị thử không hợp lệ: thử giá trị kế tiếp
    if (req.pageSize !== null && !probe.confirmed) {
      // Nền tảng chưa từng nhận kích thước này: hạ một bậc, không tính là lỗi.
      probe.index++;
      return 'retry';
    }
    if (req.resumed) return this.dropResumed(req);
    this.failures[req.kind] = (this.failures[req.kind] ?? 0) + 1;
    if (this.failures[req.kind]! >= MAX_FAILURES) {
      this.disabled[req.kind] = true;
      return 'disabled';
    }
    return 'retry';
  }

  /** Cursor / token khôi phục không còn dùng được: quay về dữ liệu trang vừa tải. */
  private dropResumed(req: PlannedRequest): RequestOutcome {
    if (req.kind === 'root') {
      this.resumedRoot = 'none';
      this.stats.resumeFailed = true;
      if (this.pageRoot) {
        this.rootCursor = this.pageRoot.cursor;
        this.rootHasNext = this.pageRoot.hasNext;
      } else {
        this.rootSeen = false; // chưa có trang đầu: để phần bấm nút lo cho tới khi thấy trang
      }
    } else if (req.threadId) {
      const thread = this.threads.get(req.threadId);
      if (thread) thread.done = true;
      this.stats.skippedThreads++;
    }
    return 'retry';
  }

  /** Trạng thái để lần chạy sau tiếp tục (null khi chưa có gì để lưu). */
  snapshot(): PagerSnapshot | null {
    if (!this.rootSeen) return null;
    return {
      v: 2,
      ownerId: this.rootOwnerId,
      rootCursor: this.rootCursor,
      rootHasNext: this.rootHasNext,
      learned: this.learnedState(),
      threads: this.threadOrder
        .filter((t) => !t.done)
        .map(({ id, token, parentDepth, cursor }) => ({ id, token, parentDepth, cursor })),
    };
  }

  /** Khôi phục trạng thái lần trước. Trả về false nếu dữ liệu không hợp lệ. */
  restore(state: unknown): boolean {
    if (!isObj(state) || state.v !== 2 || !Array.isArray(state.threads)) return false;
    this.rootOwnerId = str(state.ownerId);
    this.rootCursor = str(state.rootCursor);
    this.rootHasNext = state.rootHasNext === true && !!this.rootCursor;
    if (isObj(state.learned)) this.restoreLearned(state.learned);
    this.rootSeen = this.rootReady();
    this.resumedRoot = this.rootSeen ? 'pending' : 'none';
    for (const t of state.threads) {
      const id = str(get(t, 'id'));
      if (!id) continue;
      const parentDepth = get(t, 'parentDepth');
      const thread = this.addThread(
        id,
        str(get(t, 'token')),
        typeof parentDepth === 'number' ? parentDepth : 0,
      );
      thread.cursor = str(get(t, 'cursor'));
      thread.restored = true;
    }
    return true;
  }

  /**
   * Một dòng cho người dùng: nền tảng cho lấy bao nhiêu bình luận mỗi trang (theo từng loại
   * trang). null khi chưa gửi request API nào.
   */
  pageSizeLine(): string | null {
    const items = [...this.probes.entries()]
      .filter(([, p]) => p.requests > 0)
      .map(([key, p]) => {
        const size = p.index < PAGE_SIZES.length ? PAGE_SIZES[p.index]! : null;
        let text: string;
        if (size === null && p.maxSeen) {
          text = `${p.maxSeen}/trang (${this.platformName} cố định, không tăng được)`;
        } else if (size === null)
          text = `không nhận số lớn, dùng mặc định của ${this.platformName}`;
        else if (!p.confirmed) text = `đang thử ${size}`;
        else if (p.maxSeen) text = `${p.maxSeen}/trang (xin ${size})`;
        else text = `nhận ${size}/trang (bài chưa đủ dài để biết mức tối đa)`;
        return `${this.probeLabel(key)} ${text}`;
      });
    return items.length
      ? `Số bình luận mỗi trang ${this.platformName} cho: ${items.join('; ')}.`
      : null;
  }

  /** Ghi chú cho người dùng. */
  describe(): string {
    const r = this.stats.requests;
    const kinds = Object.keys(this.ops);
    const total = kinds.reduce((s, k) => s + (r[k] ?? 0), 0);
    if (!total) return 'Chế độ nhanh (API): chưa gửi request nào.';
    const byKind = kinds.map((k) => `${this.labels[k] ?? k} ${r[k] ?? 0}`).join(', ');
    const parts = [`Chế độ nhanh (API): ${total} request (${byKind}).`];
    if (r.root)
      parts.push(
        `Trung bình ${Math.round(this.stats.rootComments / r.root)} bình luận gốc/request.`,
      );
    if (this.stats.errors) parts.push(`${this.stats.errors} request lỗi.`);
    if (this.stats.resumeFailed) {
      parts.push('Cursor lần trước đã hết hạn — tải lại từ đầu (bình luận trùng được bỏ qua).');
    }
    if (this.stats.skippedThreads) {
      parts.push(`Bỏ qua ${this.stats.skippedThreads} nhánh reply lưu từ lần trước (đã hết hạn).`);
    }
    if (this.reachedKnown) {
      parts.push('Đã tới bình luận của lần chạy trước — dừng tải bình luận gốc.');
    }
    if (this.trialSummary) parts.push(this.trialSummary);
    const off = kinds.filter((k) => this.disabled[k]).map((k) => this.labels[k] ?? k);
    if (off.length) {
      parts.push(`Đã tắt API cho ${off.join(', ')} do lỗi liên tiếp — quay về bấm nút.`);
    }
    return parts.join(' ');
  }

  // ---- Dành cho lớp con ----------------------------------------------------------------------

  protected docId(kind: string): string {
    return this.docIdOverrides[kind] ?? this.ops[kind]!.docId;
  }

  protected findThread(id: string): Thread | undefined {
    return this.threads.get(id);
  }

  protected addThread(id: string, token: string | null, parentDepth: number): Thread {
    const existing = this.threads.get(id);
    if (existing) {
      // Facebook cấp token mới mỗi lần comment xuất hiện lại; trang dùng token mới nhất.
      if (token) existing.token = token;
      existing.restored = false;
      return existing;
    }
    const thread: Thread = { id, token, parentDepth, cursor: null, done: false, restored: false };
    this.threads.set(id, thread);
    this.threadOrder.push(thread);
    return thread;
  }

  // ---- Nội bộ ---------------------------------------------------------------------------------

  private probeLabel(key: string): string {
    const [kind, page] = key.split(':');
    const label = this.labels[kind!] ?? kind!;
    if (!page) return label;
    return `${label} (${page === 'first' ? 'trang đầu' : 'trang sau'})`;
  }

  private plan(
    kind: string,
    threadId: string | null,
    cursorBefore: string | null,
    first: boolean,
    resumed: boolean,
    trial: string | null,
    build: (count: number | null) => Json,
  ): PlannedRequest {
    const key = kind === 'root' ? 'root' : `${kind}:${first ? 'first' : 'next'}`;
    const probe = this.probe(key);
    const pageSize =
      this.sizeable(kind) && probe.index < PAGE_SIZES.length ? PAGE_SIZES[probe.index]! : null;
    return {
      kind,
      threadId,
      pageSize,
      probe: key,
      cursorBefore,
      trial,
      resumed,
      friendlyName: this.ops[kind]!.name,
      docId: this.docId(kind),
      variables: build(pageSize ?? this.defaultCount(kind, first)),
    };
  }

  private probe(key: string): Probe {
    let probe = this.probes.get(key);
    if (!probe) {
      probe = { index: 0, confirmed: false, maxSeen: 0, requests: 0 };
      this.probes.set(key, probe);
    }
    return probe;
  }

  /** Nền tảng nhận kích thước đã xin; nếu trả ít hơn (mà chưa hết trang) thì hạ xuống cho sát. */
  private learnPageSize(probe: Probe, asked: number, conn: Connection): void {
    probe.confirmed = true;
    if (!conn.hasNext) return; // trang cuối ít bình luận là bình thường
    const got = conn.edges.length;
    probe.maxSeen = Math.max(probe.maxSeen, got);
    if (got >= asked) return;
    let fit = probe.index;
    while (fit + 1 < PAGE_SIZES.length && PAGE_SIZES[fit + 1]! >= probe.maxSeen) fit++;
    // Trần thấp hơn cả bậc nhỏ nhất (vd. Facebook cố định 10/trang): gửi đúng giá trị mặc định
    // như chính trang, xin thêm cũng không được gì.
    probe.index = probe.maxSeen < PAGE_SIZES.at(-1)! ? PAGE_SIZES.length : fit;
  }

  /** Ghi kết quả một lần thử; thử xong hết thì chọn giá trị cho trang lớn nhất. */
  private recordTrial(value: string, edges: number | null): void {
    this.trials = this.trials.filter((t) => t !== value);
    if (edges !== null) this.trialResults.set(value, edges);
    if (this.trials.length) return;
    const baselineValue = this.trialBaseline();
    const baseline = (baselineValue && this.trialResults.get(baselineValue)) || 0;
    let best = baselineValue;
    let bestCount = baseline;
    for (const [v, n] of this.trialResults) {
      if (n > bestCount) {
        best = v;
        bestCount = n;
      }
    }
    if (best && best !== baselineValue) {
      this.trialSummary = `${this.trialName}: dùng ${best} (${bestCount} bình luận/trang thay vì ${baseline}).`;
      this.applyTrialWinner(best);
    } else {
      this.trialSummary = `${this.trialName}: không có giá trị nào cho trang lớn hơn.`;
    }
  }

  /** Chế độ "chỉ lấy bình luận mới": gặp bình luận không mới hơn mốc thì dừng chuỗi gốc. */
  private applyOnlyNewer(edges: unknown[]): void {
    if (this.onlyNewerThan === null) return;
    const oldest = this.oldestCreatedTime(edges);
    this.reachedKnown = oldest !== null && oldest <= this.onlyNewerThan;
    if (this.reachedKnown) this.rootHasNext = false;
  }

  /** Nhánh không bao giờ được tải: ngoài số cấp reply đã chọn, hoặc loại query đã bị tắt. */
  private skipped(t: Thread): boolean {
    const needed = t.parentDepth === 0 ? 1 : 2;
    return t.done || this.replyDepth < needed || !!this.disabled[this.threadKind(t)];
  }

  /** Còn nhánh phải tải (kể cả nhánh đang chờ đủ điều kiện). */
  private hasPendingThreads(): boolean {
    for (let i = this.threadIndex; i < this.threadOrder.length; i++) {
      if (!this.skipped(this.threadOrder[i]!)) return true;
    }
    return false;
  }

  private pickThread(): Thread | null {
    // Chỉ bước qua nhánh bị bỏ VĨNH VIỄN; nhánh chưa sẵn sàng (kindReady) vẫn chờ được tải sau.
    while (this.threadIndex < this.threadOrder.length) {
      if (!this.skipped(this.threadOrder[this.threadIndex]!)) break;
      this.threadIndex++;
    }
    for (let i = this.threadIndex; i < this.threadOrder.length; i++) {
      const t = this.threadOrder[i]!;
      if (this.skipped(t) || this.inFlightThreads.has(t.id)) continue;
      if (this.kindReady(this.threadKind(t))) return t;
    }
    return null;
  }
}
