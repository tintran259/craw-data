import type { CommentRecord, ParseContext } from '@/adapters/types';
import { get, isObj, num, str, toIsoTime, walkJson, type Json } from '@/adapters/shared/json';
import { splitJsonPayload } from '@/adapters/shared/payload-splitter';
import { instagramShortcode } from './url';

/**
 * Instagram trả bình luận qua REST (`/api/v1/media/{id}/comments/`, `…/child_comments/`) hoặc
 * GraphQL (`xdt_api__v1__media__media_id__comments__connection`). Cả hai dùng chung object
 * comment: `{pk, text, created_at, user{pk, username}, comment_like_count, child_comment_count,
 * parent_comment_id?}`. Parser duyệt toàn bộ cây JSON thay vì bám một đường dẫn cố định.
 */

/** Khóa chứa reply của comment cha (REST trả kèm vài reply xem trước). */
const REPLY_KEYS = new Set(['child_comments', 'preview_child_comments']);

function isComment(o: Json, key: string | null): boolean {
  if (key === 'caption' || o.type === 1) return false; // caption bài viết có cùng hình dạng
  if ('media_type' in o || 'caption' in o) return false; // đây là bài viết, không phải comment
  const user = o.user;
  return (
    typeof o.text === 'string' &&
    !!(str(o.pk) ?? str(o.id)) &&
    isObj(user) &&
    !!str(user.username) &&
    (num(o.created_at) !== null || num(o.created_at_utc) !== null)
  );
}

/** Comment cha suy từ request tải reply: đường dẫn REST hoặc biến GraphQL. */
function parentFromRequest(ctx: ParseContext): string | null {
  const m = /\/comments\/(\d+)\/child_comments/.exec(ctx.requestUrl ?? '');
  if (m) return m[1]!;
  if (!ctx.requestVariables) return null;
  try {
    const vars: unknown = JSON.parse(ctx.requestVariables);
    return str(get(vars, 'parent_comment_id')) ?? str(get(vars, 'comment_id'));
  } catch {
    return null;
  }
}

export function parseInstagramPayload(raw: string, ctx: ParseContext): CommentRecord[] {
  if (!raw.includes('"username"')) return [];
  const out: CommentRecord[] = [];
  const requestParent = parentFromRequest(ctx);
  walkJson(splitJsonPayload(raw), ({ value: o, key, inherited }) => {
    if (!isComment(o, key)) return undefined;
    const commentId = (str(o.pk) ?? str(o.id))!;
    const user = o.user as Json;
    const structural = key && REPLY_KEYS.has(key) ? inherited : null;
    const parentId =
      str(o.parent_comment_id) ??
      str(o.replied_to_comment_id) ??
      structural ??
      (requestParent !== commentId ? requestParent : null);
    const username = str(user.username)!;
    out.push({
      postUrl: ctx.postUrl,
      platform: 'instagram',
      commentId,
      parentId,
      depth: parentId ? 1 : 0,
      authorName: str(user.full_name) ?? username,
      authorId: str(user.pk) ?? str(user.id) ?? str(user.pk_id),
      authorProfileUrl: `https://www.instagram.com/${username}/`,
      content: o.text as string,
      attachmentUrls: [],
      reactionCount: num(o.comment_like_count) ?? num(o.like_count),
      replyCount: num(o.child_comment_count),
      createdAt: toIsoTime(o.created_at ?? o.created_at_utc),
      crawledAt: ctx.crawledAt,
    });
    return commentId;
  });
  return out;
}

/** `comment_count` của đúng bài (theo shortcode trong link). */
export function extractInstagramTotalCount(raw: string, postUrl?: string): number | null {
  if (!raw.includes('"comment_count"')) return null;
  const code = postUrl ? instagramShortcode(postUrl) : null;
  let best: number | null = null;
  walkJson(splitJsonPayload(raw), ({ value: o }) => {
    const count = num(o.comment_count);
    if (count === null) return undefined;
    const mediaCode = str(o.code) ?? str(o.shortcode);
    if (code ? mediaCode === code : true) best = Math.max(best ?? 0, count);
    return undefined;
  });
  return best;
}
