import type { CommentRecord, ParseContext } from '@/adapters/types';
import { connectionOf } from '@/adapters/shared/comment-pager';
import { get, isObj, num, str, toIsoTime, walkJson, type Json } from '@/adapters/shared/json';
import { splitJsonPayload } from '@/adapters/shared/payload-splitter';
import { threadsPostCode } from './url';

/**
 * Threads (nền Relay của Meta), cấu trúc quan sát từ dữ liệu thật (10/2026):
 * - Post / reply: `{pk, id: "<pk>_<userId>", code, caption{text}, user{pk, username, full_name},
 *   taken_at, like_count, text_post_app_info{reply_level, direct_reply_count, text_fragments}}`.
 *   `reply_level`: 0 = bài thường, 1 = reply trực tiếp vào bài, 2+ = reply lồng nhau.
 * - Danh sách reply: `text_post_app_info.direct_replies` (reply vào chính post đó) hoặc
 *   `text_post_app_info.inline_expansion` (mở rộng reply lồng nhau của post đó). Mỗi edge là một
 *   chuỗi `node.posts.edges[].node`: post đầu trả lời chủ danh sách, post sau trả lời post ngay
 *   trước nó.
 * Bài gốc (mã trong link) và các bài phía trên nó (cấp thấp hơn) không phải bình luận.
 */

/** id số của post: `pk`, hoặc phần trước "_" của `id` ("<pk>_<userId>"). */
export const threadsPk = (o: unknown): string | null =>
  str(get(o, 'pk')) ?? str(get(o, 'id'))?.split('_')[0] ?? null;

export function isThreadsPost(o: Json): boolean {
  const user = o.user;
  return (
    !!str(o.code) &&
    !!threadsPk(o) &&
    isObj(user) &&
    !!str(user.username) &&
    num(o.taken_at) !== null
  );
}

const replyLevel = (post: Json) => num(get(post, 'text_post_app_info', 'reply_level'));

function textOf(post: Json): string {
  const caption = str(get(post, 'caption', 'text'));
  if (caption) return caption;
  const fragments = get(post, 'text_post_app_info', 'text_fragments', 'fragments');
  if (Array.isArray(fragments)) {
    return fragments.map((f) => str(get(f, 'plaintext')) ?? '').join('');
  }
  return '';
}

function imagesOf(post: Json): string[] {
  const firstOf = (m: unknown) => {
    const list = get(m, 'image_versions2', 'candidates');
    return Array.isArray(list) ? str(get(list[0], 'url')) : null;
  };
  const carousel = post.carousel_media;
  const urls = Array.isArray(carousel) ? carousel.map(firstOf) : [firstOf(post)];
  return urls.filter((u): u is string => !!u);
}

/** Các post trong một chuỗi (edge của direct_replies / inline_expansion). */
function chainOf(edge: unknown): Json[] {
  const posts = connectionOf(get(edge, 'node', 'posts'));
  return (posts?.edges ?? [])
    .map((e) => get(e, 'node'))
    .filter((p): p is Json => isObj(p) && isThreadsPost(p));
}

function parseVariables(raw: string | null | undefined): Json | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

export function parseThreadsPayload(raw: string, ctx: ParseContext): CommentRecord[] {
  if (!raw.includes('"taken_at"')) return [];
  const values = splitJsonPayload(raw);
  // Ưu tiên URL trang hiện tại: link chia sẻ (/share/...) đã được chuyển sang link bài thật.
  const rootCode = threadsPostCode(ctx.pageUrl) ?? threadsPostCode(ctx.postUrl);
  const vars = parseVariables(ctx.requestVariables);
  // Bài gốc: theo mã trong link, hoặc theo biến của request tải reply.
  let rootPk = str(vars?.permalinkPostID) ?? null;
  let rootLevel = 0;
  walkJson(values, ({ value }) => {
    if (!isThreadsPost(value) || value.code !== rootCode) return undefined;
    rootPk ??= threadsPk(value);
    rootLevel = replyLevel(value) ?? 0;
    return false;
  });

  const out = new Map<string, CommentRecord>();
  const add = (post: Json, parentId: string | null, fallbackDepth: number) => {
    const pk = threadsPk(post)!;
    if (post.code === rootCode || pk === rootPk || out.has(pk)) return;
    const level = replyLevel(post);
    if (level !== null && level <= rootLevel) return; // bài gốc hoặc bài phía trên nó
    const user = post.user as Json;
    const username = str(user.username)!;
    out.set(pk, {
      postUrl: ctx.postUrl,
      platform: 'threads',
      commentId: pk,
      parentId,
      depth: level !== null ? level - rootLevel - 1 : fallbackDepth,
      authorName: str(user.full_name) ?? username,
      authorId: str(user.pk) ?? str(user.id),
      authorProfileUrl: `https://www.threads.com/@${username}`,
      content: textOf(post),
      attachmentUrls: imagesOf(post),
      reactionCount: num(post.like_count),
      replyCount: num(get(post, 'text_post_app_info', 'direct_reply_count')),
      createdAt: toIsoTime(post.taken_at),
      crawledAt: ctx.crawledAt,
    });
  };

  // 1) Danh sách reply: chủ danh sách là cha của post đầu mỗi chuỗi (bài gốc → bình luận gốc).
  walkJson(values, ({ value }) => {
    const info = value.text_post_app_info;
    const lists = [get(info, 'direct_replies'), get(info, 'inline_expansion')]
      .map(connectionOf)
      .filter((c) => c !== null);
    if (!lists.length) return undefined;
    const ownerPk = threadsPk(value);
    const ownerParent = !ownerPk || ownerPk === rootPk ? null : ownerPk;
    for (const list of lists) {
      for (const edge of list.edges) {
        chainOf(edge).forEach((post, i, chain) => {
          // Cấp ngay dưới bài gốc luôn là bình luận gốc (dù chưa biết id bài gốc trong payload này).
          const level = replyLevel(post);
          const parent =
            level !== null && level <= rootLevel + 1
              ? null
              : i === 0
                ? ownerParent
                : threadsPk(chain[i - 1]);
          add(post, parent, parent ? 1 : 0);
        });
      }
    }
    return false;
  });
  // 2) Post lẻ ngoài danh sách (vd. post đang mở hộp soạn trả lời): chỉ nhận nếu chắc là reply.
  walkJson(values, ({ value }) => {
    if (!isThreadsPost(value)) return undefined;
    const level = replyLevel(value);
    if (level !== null && level === rootLevel + 1) add(value, null, 0);
    return false;
  });
  return [...out.values()];
}

/** Số reply trực tiếp của bài gốc (Threads chỉ báo số này, không gồm reply lồng nhau). */
export function extractThreadsTotalCount(raw: string, postUrl?: string): number | null {
  if (!raw.includes('"direct_reply_count"')) return null;
  const code = postUrl ? threadsPostCode(postUrl) : null;
  let best: number | null = null;
  walkJson(splitJsonPayload(raw), ({ value: o }) => {
    if (code && str(o.code) !== code) return undefined;
    const count = num(get(o, 'text_post_app_info', 'direct_reply_count'));
    if (count !== null) best = Math.max(best ?? 0, count);
    return undefined;
  });
  return best;
}
