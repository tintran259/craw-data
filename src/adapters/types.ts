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
}

export interface ActionContext {
  signal: AbortSignal;
  includeReplies: boolean;
  /** Chờ ngẫu nhiên theo cài đặt "độ trễ giữa các thao tác". */
  humanDelay(): Promise<void>;
  /** Thời điểm (ms) nhận được payload chứa dữ liệu gần nhất. */
  lastPayloadAt(): number;
  /** Không còn nút tải thêm và không có payload mới trong khoảng này thì dừng. */
  idleStopMs: number;
  log(message: string): void;
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
  loadAllComments(ctx: ActionContext): Promise<void>;
  detectBlock(doc: Document): BlockReason | null;
  /** Trích tên operation để ghi vào dữ liệu debug. Phải loại bỏ mọi token. */
  describeRequest(url: string, body?: string): RequestInfo;
  /** Tổng số bình luận nền tảng hiển thị cho bài (để đối chiếu), nếu tìm thấy trong payload. */
  extractTotalCount(raw: string): number | null;
  /** Match pattern cho content script (vd. `https://*.facebook.com/*`). */
  contentScriptMatches: string[];
  interceptTargets: InterceptTarget[];
}
