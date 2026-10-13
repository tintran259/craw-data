import {
  CommentPager,
  connectionOf,
  type Connection,
  type PagerOptions,
  type Thread,
} from '@/adapters/shared/comment-pager';
import { get, isObj, num, str, walkJson, type Json } from '@/adapters/shared/json';
import { isThreadsPost, threadsPk } from './parser';

/**
 * Chế độ nhanh cho Threads. Cấu trúc quan sát từ dữ liệu thật (10/2026), cùng nền Relay với Facebook:
 * - Reply trực tiếp vào bài: `BarcelonaPostPageDirectRepliesRefetchQuery {after, first, postID,
 *   sortOrder, filterType}` → `data.media.text_post_app_info.direct_replies{edges, page_info}`; mỗi
 *   edge là một chuỗi post (`node.posts.edges[].node`). Trang xin 4; trang đầu nhúng trong HTML.
 * - Reply lồng nhau của một post: `BarcelonaPostPageThreadViewSectionInlineExpansionQuery
 *   {after, permalinkPostID, postID}` → `…text_post_app_info.inline_expansion` (không có tham số
 *   số lượng).
 * - Mỗi request mang ~38 biến `__relay_internal__pv__*` không có trong HTML: phải học từ một
 *   request do chính trang gửi (khi cuộn) rồi mới tự gọi được.
 */

export const THREADS_COMMENT_OPS = {
  root: { name: 'BarcelonaPostPageDirectRepliesRefetchQuery', docId: '39174479065528985' },
  reply: {
    name: 'BarcelonaPostPageThreadViewSectionInlineExpansionQuery',
    docId: '27015475921483929',
  },
};

const replyLevel = (post: Json) => num(get(post, 'text_post_app_info', 'reply_level'));

export class ThreadsCommentPager extends CommentPager {
  protected readonly ops = THREADS_COMMENT_OPS;
  protected readonly platformName = 'Threads';
  protected readonly labels = { root: 'gốc', reply: 'reply lồng nhau' };
  protected readonly markers = ['text_post_app_info'];
  /** Mã bài trong link — để nhận ra bài gốc (id và cấp của nó) trong payload. */
  private readonly postCode: string | null;
  private rootPk: string | null = null;
  /** `reply_level` của bài gốc (0 nếu là bài thường; >0 nếu link trỏ tới một reply). */
  private rootLevel = 0;
  /** Biến chung học từ request của trang; null = chưa học, chưa tự gọi được. */
  private relayProviders: Json | null = null;
  private sortOrder = 'TOP';
  private filterType: unknown = null;

  constructor(options: PagerOptions & { postCode: string | null }) {
    super({ replyDepth: options.replyDepth });
    this.postCode = options.postCode;
  }

  protected override rootReady(): boolean {
    return !!this.rootOwnerId && this.relayProviders !== null;
  }

  protected override kindReady(): boolean {
    return this.relayProviders !== null;
  }

  protected override sizeable(kind: string): boolean {
    return kind === 'root';
  }

  protected override defaultCount(kind: string): number | null {
    return kind === 'root' ? 4 : null;
  }

  protected override ownerMatches(ownerId: string | null): boolean {
    return !this.rootPk || !ownerId || ownerId === this.rootPk;
  }

  protected isRootSource(operationName: string | null): boolean {
    return operationName === null || operationName === THREADS_COMMENT_OPS.root.name;
  }

  protected findRootList(values: unknown[]) {
    this.learnRootPost(values);
    let found: { ownerId: string | null; conn: Connection } | null = null;
    walkJson(values, ({ value }) => {
      const conn = connectionOf(get(value, 'text_post_app_info', 'direct_replies'));
      const ownerId = conn ? threadsPk(value) : null;
      if (conn && this.ownerMatches(ownerId)) found = { ownerId, conn };
      return found ? false : undefined;
    });
    return found;
  }

  protected findThreadList(values: unknown[]): Connection | null {
    let found: Connection | null = null;
    walkJson(values, ({ value }) => {
      const conn = connectionOf(get(value, 'text_post_app_info', 'inline_expansion'));
      if (conn && !found) found = conn;
      return conn ? false : undefined;
    });
    return found;
  }

  /** Mỗi reply còn reply con chưa tải → một nhánh (mở bằng InlineExpansion). */
  protected scanPayload(values: unknown[]): void {
    walkJson(values, ({ value }) => {
      if (!isThreadsPost(value)) return undefined;
      const level = replyLevel(value);
      const pk = threadsPk(value);
      const replies = num(get(value, 'text_post_app_info', 'direct_reply_count')) ?? 0;
      if (pk && level !== null && level > this.rootLevel && replies > 0) {
        this.addThread(pk, null, level - this.rootLevel - 1);
      }
      return undefined;
    });
  }

  protected threadOfRequest(_kind: string, vars: Json) {
    const id = str(vars.postID);
    return id ? { id, token: null, parentDepth: this.findThread(id)?.parentDepth ?? 1 } : null;
  }

  protected threadKind(): string {
    return 'reply';
  }

  protected rootVariables(cursor: string, count: number | null): Json {
    return {
      after: cursor,
      filterType: this.filterType,
      first: count,
      postID: this.rootOwnerId,
      sortOrder: this.sortOrder,
      ...this.relayProviders,
    };
  }

  protected threadVariables(t: Thread): Json {
    return {
      after: t.cursor,
      permalinkPostID: this.rootOwnerId,
      postID: t.id,
      ...this.relayProviders,
    };
  }

  protected learnVariables(operationName: string, vars: Json): void {
    const isRoot = operationName === THREADS_COMMENT_OPS.root.name;
    if (!isRoot && operationName !== THREADS_COMMENT_OPS.reply.name) return;
    const relay = Object.entries(vars).filter(([k]) => k.startsWith('__relay_internal__pv__'));
    if (relay.length) this.relayProviders = Object.fromEntries(relay);
    if (isRoot) {
      this.rootPk ??= str(vars.postID);
      this.sortOrder = str(vars.sortOrder) ?? this.sortOrder;
      this.filterType = vars.filterType ?? null;
    } else {
      this.rootPk ??= str(vars.permalinkPostID);
    }
  }

  protected learnedState(): Json {
    return {
      relay: this.relayProviders,
      sortOrder: this.sortOrder,
      filterType: this.filterType,
      rootPk: this.rootPk,
      rootLevel: this.rootLevel,
    };
  }

  protected restoreLearned(state: Json): void {
    if (isObj(state.relay)) this.relayProviders = state.relay;
    this.sortOrder = str(state.sortOrder) ?? this.sortOrder;
    this.filterType = state.filterType ?? null;
    this.rootPk = str(state.rootPk) ?? this.rootPk;
    this.rootLevel = num(state.rootLevel) ?? this.rootLevel;
  }

  /** Bài gốc (theo mã trong link): lấy id và cấp của nó. */
  private learnRootPost(values: unknown[]): void {
    if (!this.postCode) return;
    walkJson(values, ({ value }) => {
      if (!isThreadsPost(value) || value.code !== this.postCode) return undefined;
      this.rootPk ??= threadsPk(value);
      this.rootLevel = replyLevel(value) ?? this.rootLevel;
      return false;
    });
  }
}
