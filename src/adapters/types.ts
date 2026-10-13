export type Platform = 'facebook' | 'instagram' | 'threads' | 'tiktok' | 'x';

export interface CommentRecord {
  /** Link người dùng nhập. */
  postUrl: string;
  platform: Platform;
  commentId: string;
  /** null = comment gốc. */
  parentId: string | null;
  /** 0 = comment gốc, 1 = reply, 2 = reply của reply... */
  depth: number;
  authorName: string;
  authorId: string | null;
  authorProfileUrl: string | null;
  /** Giữ nguyên emoji, xuống dòng. */
  content: string;
  attachmentUrls: string[];
  reactionCount: number | null;
  replyCount: number | null;
  /** ISO 8601. */
  createdAt: string | null;
  /** ISO 8601. */
  crawledAt: string;
}

export type BlockCode = 'rate_limited' | 'checkpoint' | 'login_required' | 'unavailable';

export interface BlockReason {
  code: BlockCode;
  /** Thông điệp tiếng Việt hiển thị cho người dùng. */
  message: string;
}

export interface ParseContext {
  postUrl: string;
  /** ISO 8601, dùng làm `crawledAt` cho các bản ghi tạo ra. */
  crawledAt: string;
  /**
   * `variables` của request GraphQL (nếu có). Response tải thêm reply đôi khi không chứa
   * comment cha, khi đó adapter có thể suy ra cha từ biến của request.
   */
  requestVariables?: string | null;
  /** origin + pathname của request (không có query). Vd. endpoint reply chứa id comment cha. */
  requestUrl?: string | null;
  /**
   * URL hiện tại của trang. Khác `postUrl` khi người dùng nhập link chia sẻ (/share/...) và trang
   * đã tự chuyển sang link bài thật — dùng để biết đâu là bài gốc.
   */
  pageUrl?: string | null;
}

/** Một response có thể chứa bình luận, kèm mô tả request (không có token). */
export interface ObservedPayload {
  /** null = khối JSON nhúng trong HTML. */
  operationName: string | null;
  docId: string | null;
  variables: string | null;
  raw: string;
  /** `api` = response của request do chế độ nhanh tự gửi; mặc định là trang tự tải. */
  source?: 'page' | 'api';
}

/** Một lời gọi GraphQL do adapter lập (operation + biến), content script lo phần token/gửi. */
export interface GraphqlCall {
  friendlyName: string;
  docId: string;
  variables: Record<string, unknown>;
}

/**
 * Gọi API GraphQL ngay trong trang (dùng phiên đăng nhập và token của chính trang;
 * token không rời khỏi tab). Response được xử lý như response trang tự tải: lưu bình luận,
 * cập nhật `lastPayloadAt`, và báo cho các subscriber.
 */
export interface GraphqlAccess {
  /** Nhận mọi payload: phát lại các payload đã có từ đầu trang, rồi các payload mới. */
  subscribe(listener: (p: ObservedPayload) => void): () => void;
  /** Đã có request GraphQL nào của trang để mượn token chưa. */
  ready(): boolean;
  request(call: GraphqlCall): Promise<{ status: number; raw: string }>;
  /** Nghỉ giữa các request API (theo cài đặt). Không bị Chrome kìm khi cửa sổ bị che. */
  delay(): Promise<void>;
  /** Nghỉ đúng `ms` (vd. chờ khi Facebook báo lỗi tạm thời). */
  sleep(ms: number): Promise<void>;
  /** Số luồng tải reply song song với chuỗi bình luận gốc. */
  replyLanes: number;
  /** Thử nghiệm: dò `feedLocation` cho trang lớn hơn. */
  probeFeedLocation: boolean;
}

export interface ActionContext {
  signal: AbortSignal;
  /** 0 = không lấy reply, 1 = chỉ reply của bình luận gốc, 2 = tất cả các cấp. */
  replyDepth: 0 | 1 | 2;
  /** Chế độ nhanh: null khi tắt hoặc nền tảng không hỗ trợ. */
  graphql: GraphqlAccess | null;
  /** Chờ ngẫu nhiên theo cài đặt "độ trễ giữa các thao tác". */
  humanDelay(): Promise<void>;
  /**
   * Gọi ngay sau khi bấm nút tải thêm: chờ tới khi có payload mới (tối đa bằng độ trễ thao tác)
   * rồi nghỉ ngắn. Nhanh hơn `humanDelay` khi Facebook trả dữ liệu sớm.
   */
  afterClick(): Promise<void>;
  /** Thời điểm (ms) nhận được payload chứa dữ liệu gần nhất. */
  lastPayloadAt(): number;
  /** Không còn nút tải thêm và không có payload mới trong khoảng này thì dừng. */
  idleStopMs: number;
  log(message: string): void;
  /** Cập nhật ghi chú hiển thị cho người dùng ngay trong lúc đang chạy. */
  report(note: string): void;
  /** Chỉ lấy bình luận mới hơn mốc này (giây Unix, theo lần chạy trước); null = lấy hết. */
  onlyNewerThan: number | null;
  /** Trạng thái lưu từ lần chạy trước của bài này (để chạy tiếp); null = chạy từ đầu. */
  resume: unknown;
  /** Đăng ký hàm lấy trạng thái hiện tại; content script gọi định kỳ để lưu (chạy tiếp lần sau). */
  checkpoint(getState: () => unknown): void;
}

/** Thông tin mô tả một request, dùng cho Debug mode. Không chứa token/cookie. */
export interface RequestInfo {
  operationName: string | null;
  docId: string | null;
  variables: string | null;
}

/** Cấu hình tối giản cho interceptor (MAIN world). Không chứa logic parse. */
export interface InterceptTarget {
  /** Hậu tố hostname, ví dụ `facebook.com`. */
  hostSuffix: string;
  /** Tiền tố pathname của endpoint, ví dụ `/api/graphql/`. */
  pathPrefixes: string[];
}

/** Thông tin nhận diện nền tảng — có cho mọi nền tảng, kể cả nền tảng chưa hỗ trợ. */
export interface PlatformInfo {
  id: Platform;
  label: string;
  matchUrl(url: string): boolean;
}

export interface PlatformAdapter {
  id: Platform;
  matchUrl(url: string): boolean;
  normalizeUrl(url: string): string;
  isTargetRequest(url: string, body?: string): boolean;
  parsePayload(raw: string, ctx: ParseContext): CommentRecord[];
  parseInitialHtml(doc: Document, ctx: ParseContext): CommentRecord[];
  /** Trả về ghi chú cho người dùng (số lần bấm, lý do dừng) để đối chiếu khi thiếu dữ liệu. */
  loadAllComments(ctx: ActionContext): Promise<string | null>;
  detectBlock(doc: Document): BlockReason | null;
  /** Trích tên operation để ghi vào dữ liệu debug. Phải loại bỏ mọi token. */
  describeRequest(url: string, body?: string): RequestInfo;
  /**
   * Tổng số bình luận nền tảng hiển thị cho bài (để đối chiếu), nếu tìm thấy trong payload.
   * `postUrl` giúp chọn đúng bài khi payload chứa cả bài khác (gợi ý, trích dẫn...).
   */
  extractTotalCount(raw: string, postUrl?: string): number | null;
  /** Match pattern cho content script (vd. `https://*.facebook.com/*`). */
  contentScriptMatches: string[];
  /** Có chế độ nhanh (gọi thẳng API GraphQL của trang) — content script chỉ chuẩn bị khi có. */
  supportsFastMode: boolean;
}
