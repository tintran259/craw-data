import {
  CommentPager,
  connectionOf,
  type Connection,
  type PagerOptions,
  type Thread,
} from '@/adapters/shared/comment-pager';
import { isObj, num, str, walkJson, type Json } from '@/adapters/shared/json';

/**
 * Chế độ nhanh cho Instagram. Cấu trúc quan sát từ dữ liệu thật (10/2026), web dùng Relay GraphQL:
 * - Bình luận gốc: `PolarisPostCommentsPaginationQuery {after, first, media_id, sort_order}` →
 *   `data.xdt_api__v1__media__media_id__comments__connection{edges[].node, page_info}`
 *   (xin 10, Instagram trả 15). Trang đầu nhúng sẵn trong HTML.
 * - Reply: `PolarisPostChildCommentsQuery {parent_comment_id, media_id, after}` →
 *   `…__comments__parent_comment_id__child_comments__connection`.
 * - Comment = `XDTCommentDict {pk, text, created_at, user, child_comment_count, parent_comment_id}`.
 * `media_id` không nằm trong danh sách — lấy từ bài viết có `code` trùng link, hoặc biến request.
 */

export const IG_COMMENT_OPS = {
  root: { name: 'PolarisPostCommentsPaginationQuery', docId: '28428885330094742' },
  reply: { name: 'PolarisPostChildCommentsQuery', docId: '28027289793632076' },
};

const ROOT_CONNECTION = 'xdt_api__v1__media__media_id__comments__connection';
const CHILD_CONNECTION =
  'xdt_api__v1__media__media_id__comments__parent_comment_id__child_comments__connection';
const DEFAULT_RELAY_PROVIDERS: Json = {
  __relay_internal__pv__PolarisIsLoggedInrelayprovider: true,
};

function findConnection(values: unknown[], key: string): Connection | null {
  let found: Connection | null = null;
  walkJson(values, ({ value }) => {
    const conn = connectionOf(value[key]);
    if (conn) found = conn;
    return found ? false : undefined;
  });
  return found;
}

export class InstagramCommentPager extends CommentPager {
  protected readonly ops = IG_COMMENT_OPS;
  protected readonly platformName = 'Instagram';
  protected readonly labels = { root: 'gốc', reply: 'reply' };
  protected readonly markers = ['XDTCommentDict', 'comments__connection'];
  /** Shortcode trong link — để nhận ra bài viết (và lấy media id) trong payload. */
  private readonly postCode: string | null;
  private mediaId: string | null = null;
  private sortOrder = 'popular';
  private relayProviders: Json = { ...DEFAULT_RELAY_PROVIDERS };

  constructor(options: PagerOptions & { postCode: string | null }) {
    // Instagram sắp "phổ biến", không theo thời gian: chưa hỗ trợ "chỉ lấy bình luận mới".
    super({ replyDepth: options.replyDepth });
    this.postCode = options.postCode;
  }

  protected override rootReady(): boolean {
    return !!this.mediaId;
  }

  /** Khối chứa bài viết (để lấy media id) có thể không chứa bình luận nào. */
  protected override isRelevant(raw: string): boolean {
    return (
      super.isRelevant(raw) || (!this.mediaId && !!this.postCode && raw.includes(this.postCode))
    );
  }

  protected isRootSource(operationName: string | null): boolean {
    return operationName === null || operationName === IG_COMMENT_OPS.root.name;
  }

  protected findRootList(values: unknown[]) {
    const conn = findConnection(values, ROOT_CONNECTION);
    return conn ? { ownerId: this.mediaId, conn } : null;
  }

  protected findThreadList(values: unknown[]): Connection | null {
    return findConnection(values, CHILD_CONNECTION);
  }

  protected scanPayload(values: unknown[]): void {
    walkJson(values, ({ value }) => {
      // Bài viết (để lấy media id): có `code` trùng link.
      if (!this.mediaId && this.postCode && value.code === this.postCode) {
        this.mediaId = str(value.pk) ?? str(value.id)?.split('_')[0] ?? null;
      }
      // Bình luận gốc có reply → một nhánh.
      if (value.__typename === 'XDTCommentDict' && !value.parent_comment_id) {
        const pk = str(value.pk);
        if (pk && (num(value.child_comment_count) ?? 0) > 0) this.addThread(pk, null, 0);
      }
      return undefined;
    });
  }

  protected threadOfRequest(_kind: string, vars: Json) {
    const id = str(vars.parent_comment_id);
    return id ? { id, token: null, parentDepth: 0 } : null;
  }

  protected threadKind(): string {
    return 'reply';
  }

  /** Trang gửi `first: 10` cho bình luận gốc, `first: null` cho reply. */
  protected override defaultCount(kind: string): number | null {
    return kind === 'root' ? 10 : null;
  }

  protected rootVariables(cursor: string, count: number | null): Json {
    return {
      after: cursor,
      before: null,
      first: count,
      last: null,
      media_id: this.mediaId,
      sort_order: this.sortOrder,
      ...this.relayProviders,
    };
  }

  protected threadVariables(t: Thread, count: number | null): Json {
    return {
      after: t.cursor,
      before: null,
      media_id: this.mediaId,
      parent_comment_id: t.id,
      is_chronological: null,
      first: count,
      last: null,
      ...this.relayProviders,
    };
  }

  protected learnVariables(operationName: string, vars: Json): void {
    if (operationName !== IG_COMMENT_OPS.root.name && operationName !== IG_COMMENT_OPS.reply.name) {
      return;
    }
    this.mediaId = str(vars.media_id) ?? this.mediaId;
    this.sortOrder = str(vars.sort_order) ?? this.sortOrder;
    for (const [key, value] of Object.entries(vars)) {
      if (key.startsWith('__relay_internal__pv__')) this.relayProviders[key] = value;
    }
  }

  protected learnedState(): Json {
    return { mediaId: this.mediaId, sortOrder: this.sortOrder, relay: this.relayProviders };
  }

  protected restoreLearned(state: Json): void {
    this.mediaId = str(state.mediaId) ?? this.mediaId;
    this.sortOrder = str(state.sortOrder) ?? this.sortOrder;
    if (isObj(state.relay)) this.relayProviders = { ...DEFAULT_RELAY_PROVIDERS, ...state.relay };
  }
}
