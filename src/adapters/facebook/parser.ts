import type { CommentRecord, ParseContext } from '@/adapters/types';
import { get, isObj, num, str, toIsoTime, walkJson, type Json } from '@/adapters/shared/json';
import { splitJsonPayload } from '@/adapters/shared/payload-splitter';

/**
 * Parser dựa trên cấu trúc thật quan sát được (xem __fixtures__):
 * node `{"__typename":"Comment", id, legacy_fbid, depth, created_time, author, body, ...}`
 * xuất hiện ở bất kỳ độ sâu nào trong payload Relay. Reply nằm trong
 * `feedback.replies_connection.edges[].node` của comment cha.
 *
 * Vì Facebook đổi đường dẫn thường xuyên, parser duyệt toàn bộ cây JSON
 * thay vì bám vào một đường dẫn cố định.
 */

/** Các khóa trỏ ngược lên comment cha — không duyệt vào để tránh coi cha là con. */
const BACKREF_KEYS = new Set(['comment_direct_parent', 'comment_parent', 'parent_object_ent']);

/** `comment:POST_CID` hoặc `feedback:POST_CID` (base64) → `CID`. */
export function decodeFbObjectId(id: string, prefix: 'comment' | 'feedback'): string | null {
  let decoded: string;
  try {
    decoded = atob(id);
  } catch {
    return null;
  }
  if (!decoded.startsWith(`${prefix}:`)) return null;
  const rest = decoded.slice(prefix.length + 1);
  const underscore = rest.lastIndexOf('_');
  return underscore >= 0 ? rest.slice(underscore + 1) || null : null;
}

function commentIdOf(node: unknown): string | null {
  if (!isObj(node)) return null;
  const legacy = str(node.legacy_fbid);
  if (legacy) return legacy;
  const id = str(node.id);
  return id ? (decodeFbObjectId(id, 'comment') ?? id) : null;
}

function isFullComment(node: Json): boolean {
  return (
    node.__typename === 'Comment' &&
    typeof node.id === 'string' &&
    'author' in node &&
    ('body' in node || 'preferred_body' in node || 'created_time' in node)
  );
}

const reactorsCount = (feedback: unknown) =>
  num(get(feedback, 'reactors', 'count')) ?? num(get(feedback, 'unified_reactors', 'count'));

function reactionCount(node: Json): number | null {
  const direct = reactorsCount(node.feedback);
  if (direct !== null) return direct;
  const links = node.comment_action_links;
  if (Array.isArray(links)) {
    for (const link of links) {
      const count = reactorsCount(get(link, 'comment', 'feedback'));
      if (count !== null) return count;
    }
  }
  // "count_reduced" có thể là "1.2K" — chỉ dùng khi là số nguyên thuần.
  const reduced = str(get(node, 'feedback', 'reactors', 'count_reduced'));
  return reduced && /^\d+$/.test(reduced) ? Number(reduced) : null;
}

function attachmentUrls(node: Json): string[] {
  const list = node.attachments;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const att of list) {
    const media = get(att, 'style_type_renderer', 'attachment', 'media') ?? get(att, 'media');
    // Bỏ ảnh xem trước của link chia sẻ (GenericAttachmentMedia) — không phải ảnh người dùng đính kèm.
    if (!isObj(media) || media.__typename === 'GenericAttachmentMedia') continue;
    const uri =
      str(get(media, 'animated_image', 'uri')) ??
      str(get(media, 'image', 'uri')) ??
      str(get(media, 'massive_image', 'uri')) ??
      str(get(media, 'sticker_image', 'uri'));
    if (uri) out.push(uri);
  }
  return out;
}

function toRecord(
  node: Json,
  structuralParent: string | null,
  fallbackParent: string | null,
  ctx: ParseContext,
): CommentRecord | null {
  const commentId = commentIdOf(node);
  if (!commentId) return null;
  const declaredDepth = num(node.depth);
  const parentId =
    commentIdOf(node.comment_direct_parent) ??
    structuralParent ??
    (declaredDepth !== null && declaredDepth > 0 ? fallbackParent : null);
  const author = isObj(node.author) ? node.author : {};
  return {
    postUrl: ctx.postUrl,
    platform: 'facebook',
    commentId,
    parentId,
    depth: declaredDepth ?? (parentId ? 1 : 0),
    authorName: str(author.name) ?? '',
    authorId: str(author.id),
    authorProfileUrl: str(author.url),
    // `body` là bản gốc; `preferred_body` có thể là bản dịch.
    content: str(get(node, 'body', 'text')) ?? str(get(node, 'preferred_body', 'text')) ?? '',
    attachmentUrls: attachmentUrls(node),
    reactionCount: reactionCount(node),
    replyCount:
      num(get(node, 'feedback', 'replies_fields', 'total_count')) ??
      num(get(node, 'feedback', 'replies_fields', 'count')),
    createdAt: toIsoTime(num(node.created_time)),
    crawledAt: ctx.crawledAt,
  };
}

/** Lấy comment cha từ `variables` của request tải reply (id là feedback của comment cha). */
function parentFromVariables(variables: string | null | undefined): string | null {
  if (!variables) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(variables);
  } catch {
    return null;
  }
  for (const key of ['id', 'feedbackID', 'feedback_id', 'parentID']) {
    const value = str(get(parsed, key));
    const cid = value ? decodeFbObjectId(value, 'feedback') : null;
    if (cid) return cid;
  }
  return null;
}

export function parseFacebookPayload(raw: string, ctx: ParseContext): CommentRecord[] {
  if (!raw.includes('"Comment"')) return [];
  const out: CommentRecord[] = [];
  const fallbackParent = parentFromVariables(ctx.requestVariables);
  // `inherited` = id comment gần nhất phía trên (comment cha theo cấu trúc).
  walkJson(splitJsonPayload(raw), ({ value, key, inherited }) => {
    if (key && BACKREF_KEYS.has(key)) return false;
    if (!isFullComment(value)) return undefined;
    const record = toRecord(value, inherited, fallbackParent, ctx);
    if (!record) return undefined;
    out.push(record);
    return record.commentId;
  });
  return out;
}

/**
 * Tổng số bình luận Facebook báo cho bài viết: `total_count` của danh sách comment gốc
 * (object có `comments.edges` và `comments.total_count`) không nằm trong một comment.
 */
export function extractFacebookTotalCount(raw: string): number | null {
  if (!raw.includes('"total_count"')) return null;
  let best: number | null = null;
  walkJson(splitJsonPayload(raw), ({ value }) => {
    if (value.__typename === 'Comment') return false; // danh sách reply bên trong comment
    const comments = value.comments;
    if (isObj(comments) && Array.isArray(comments.edges)) {
      const total = num(comments.total_count) ?? num(comments.count);
      if (total !== null) best = Math.max(best ?? 0, total);
    }
    return undefined;
  });
  return best;
}
