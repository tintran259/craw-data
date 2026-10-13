import {
  CommentPager,
  connectionOf,
  type Connection,
  type PagerOptions,
  type Thread,
} from '@/adapters/shared/comment-pager';
import { get, isObj, num, str, walkJson, type Json } from '@/adapters/shared/json';

export { PAGE_SIZES, type PlannedRequest } from '@/adapters/shared/comment-pager';

/**
 * Chế độ nhanh cho Facebook. Cấu trúc quan sát từ dữ liệu thật (10/2026):
 * - Danh sách gốc: `Feedback.comment_rendering_instance_for_feed_location.comments{edges,page_info}`;
 *   trang sau = `CommentsListComponentsPaginationQuery` với `commentsAfterCursor`.
 * - Reply: mỗi Comment có `feedback{id, expansion_info.expansion_token}`; nhánh reply cấp 1 =
 *   `Depth1CommentsListPaginationQuery`, cấp 2 = `Depth2…`; kết quả ở `data.node.replies_connection`.
 * `doc_id` dưới đây chỉ là giá trị dự phòng — luôn ưu tiên `doc_id` thấy trong request thật của trang.
 */

export const FB_COMMENT_OPS = {
  root: { name: 'CommentsListComponentsPaginationQuery', docId: '40120064807592280' },
  depth1: { name: 'Depth1CommentsListPaginationQuery', docId: '28879879234997632' },
  depth2: { name: 'Depth2CommentsListPaginationQuery', docId: '29450873471180849' },
};

const DEFAULT_INTENT = 'RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1';
const DEFAULT_FEED_LOCATION = 'POST_PERMALINK_DIALOG';
const DEFAULT_RELAY_PROVIDERS: Record<string, unknown> = {
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
};

/**
 * Thử nghiệm: `page_size` Facebook trả thay đổi theo `feedLocation` (bài viết 10, reel 6).
 * Chưa có tài liệu nào về giá trị cho trang lớn hơn — chỉ dò khi người dùng bật.
 */
export const FEED_LOCATION_CANDIDATES = [
  'DEDICATED_COMMENTING_SURFACE',
  'PERMALINK',
  'POST_PERMALINK_DIALOG',
  'COMET_MEDIA_VIEWER',
  'TAHOE',
  'NEWSFEED',
];

/** `data.node.replies_connection` của response tải reply. */
function findReplyList(values: unknown[]): Connection | null {
  for (const v of values) {
    const conn = connectionOf(get(v, 'data', 'node', 'replies_connection'));
    if (conn) return conn;
  }
  return null;
}

function replyCountOf(feedback: Json): number {
  return (
    num(get(feedback, 'replies_fields', 'total_count')) ??
    num(get(feedback, 'replies_fields', 'count')) ??
    num(get(feedback, 'replies', 'count')) ??
    0
  );
}

export class FacebookCommentPager extends CommentPager {
  protected readonly ops = FB_COMMENT_OPS;
  protected readonly platformName = 'Facebook';
  protected override trialName = 'Dò feedLocation';
  protected readonly labels = { root: 'gốc', depth1: 'reply cấp 1', depth2: 'reply cấp 2' };
  protected readonly markers = ['"Comment"', 'comment_rendering_instance'];
  private feedLocation = DEFAULT_FEED_LOCATION;
  private intentToken = DEFAULT_INTENT;
  private readonly relayProviders: Record<string, unknown> = { ...DEFAULT_RELAY_PROVIDERS };

  constructor(options: PagerOptions & { probeFeedLocation?: boolean }) {
    super(options);
    if (options.probeFeedLocation) this.trials = [...FEED_LOCATION_CANDIDATES];
  }

  // Chỉ nhận danh sách gốc từ query bình luận hoặc JSON trong HTML: trang Reel còn tải kèm
  // dữ liệu của các video khác (FBUnifiedVideoContainerQuery…).
  protected isRootSource(operationName: string | null): boolean {
    return operationName === null || /Comment/.test(operationName);
  }

  protected findRootList(values: unknown[]) {
    let found: { ownerId: string | null; conn: Connection } | null = null;
    walkJson(values, ({ value }) => {
      if (value.__typename === 'Comment') return false;
      const instance = value.comment_rendering_instance_for_feed_location;
      const conn = isObj(instance) ? connectionOf(instance.comments) : null;
      if (conn) found = { ownerId: str(value.id), conn };
      return undefined;
    });
    return found;
  }

  protected findThreadList(values: unknown[]): Connection | null {
    return findReplyList(values);
  }

  /** Nhánh reply theo đúng thứ tự trong trang. */
  protected scanPayload(values: unknown[]): void {
    walkJson(values, ({ value }) => {
      if (value.__typename !== 'Comment' || !isObj(value.feedback)) return undefined;
      const fb = value.feedback;
      const id = str(fb.id);
      const token = str(get(fb, 'expansion_info', 'expansion_token'));
      if (id && token && replyCountOf(fb) > 0) this.addThread(id, token, num(value.depth) ?? 0);
      return undefined;
    });
  }

  protected threadOfRequest(kind: string, vars: Json) {
    const id = str(vars.id);
    const token = str(vars.expansionToken);
    return id && token ? { id, token, parentDepth: kind === 'depth1' ? 0 : 1 } : null;
  }

  protected threadKind(t: Thread): string {
    return t.parentDepth === 0 ? 'depth1' : 'depth2';
  }

  protected override threadKindsFor(replyDepth: 1 | 2): string[] {
    return replyDepth === 1 ? ['depth1'] : ['depth1', 'depth2'];
  }

  protected rootVariables(cursor: string, count: number | null, trial: string | null): Json {
    return {
      commentsAfterCount: count,
      commentsAfterCursor: cursor,
      commentsBeforeCount: null,
      commentsBeforeCursor: null,
      commentsIntentToken: this.intentToken,
      feedLocation: trial ?? this.feedLocation,
      focusCommentID: null,
      scale: 1,
      targetDialect: null,
      useDefaultActor: false,
      id: this.rootOwnerId,
      ...this.relayProviders,
    };
  }

  protected threadVariables(t: Thread, count: number | null): Json {
    const common = {
      clientKey: null,
      expansionToken: t.token,
      feedLocation: this.feedLocation,
      scale: 1,
      useDefaultActor: false,
      id: t.id,
    };
    return this.threadKind(t) === 'depth1'
      ? {
          ...common,
          focusCommentID: null,
          repliesAfterCount: count,
          repliesAfterCursor: t.cursor,
          repliesBeforeCount: null,
          repliesBeforeCursor: null,
          ...this.relayProviders,
        }
      : {
          ...common,
          subRepliesAfterCount: count,
          subRepliesAfterCursor: t.cursor,
          subRepliesBeforeCount: null,
          subRepliesBeforeCursor: null,
          ...this.relayProviders,
        };
  }

  protected learnVariables(operationName: string, vars: Json): void {
    if (!/Comment/.test(operationName)) return;
    const location = str(vars.feedLocation);
    if (location) this.feedLocation = location;
    const intent = str(vars.commentsIntentToken);
    if (intent) this.intentToken = intent;
    for (const [key, value] of Object.entries(vars)) {
      if (key in DEFAULT_RELAY_PROVIDERS) this.relayProviders[key] = value;
    }
  }

  protected learnedState(): Json {
    return { feedLocation: this.feedLocation, intentToken: this.intentToken };
  }

  protected restoreLearned(state: Json): void {
    this.feedLocation = str(state.feedLocation) ?? DEFAULT_FEED_LOCATION;
    this.intentToken = str(state.intentToken) ?? DEFAULT_INTENT;
  }

  protected override oldestCreatedTime(edges: unknown[]): number | null {
    let oldest: number | null = null;
    for (const edge of edges) {
      const t = num(get(edge, 'node', 'created_time'));
      if (t !== null) oldest = oldest === null ? t : Math.min(oldest, t);
    }
    return oldest;
  }

  protected override trialBaseline(): string {
    return this.feedLocation;
  }

  protected override applyTrialWinner(value: string): void {
    this.feedLocation = value;
  }
}
