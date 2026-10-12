import type { CommentRecord, ParseContext } from '@/adapters/types';
import { splitJsonPayload } from './payload-splitter';

/**
 * Parser dựa trên cấu trúc thật quan sát được (xem __fixtures__):
 * node `{"__typename":"Comment", id, legacy_fbid, depth, created_time, author, body, ...}`
 * xuất hiện ở bất kỳ độ sâu nào trong payload Relay. Reply nằm trong
 * `feedback.replies_connection.edges[].node` của comment cha.
 *
 * Vì Facebook đổi đường dẫn thường xuyên, parser duyệt toàn bộ cây JSON
 * thay vì bám vào một đường dẫn cố định.
 */

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const get = (o: unknown, ...path: string[]): unknown => {
  let cur = o;
  for (const key of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
};

/** Các khóa trỏ ngược lên comment cha — không duyệt vào để tránh coi cha là con. */
const BACKREF_KEYS = new Set(['comment_direct_parent', 'comment_parent', 'parent_object_ent']);

function decodeBase64(value: string): string | null {
  try {
    return atob(value);
  } catch {
    return null;
  }
}

/** `comment:POST_CID` hoặc `feedback:POST_CID` (base64) → `CID`. */
export function decodeFbObjectId(id: string, prefix: 'comment' | 'feedback'): string | null {
  const decoded = decodeBase64(id);
  if (!decoded?.startsWith(`${prefix}:`)) return null;
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

function reactionCount(node: Json): number | null {
  const direct =
    num(get(node, 'feedback', 'reactors', 'count')) ??
    num(get(node, 'feedback', 'unified_reactors', 'count'));
  if (direct !== null) return direct;
  const links = node.comment_action_links;
  if (Array.isArray(links)) {
    for (const link of links) {
      const fb = get(link, 'comment', 'feedback');
      const count = num(get(fb, 'reactors', 'count')) ?? num(get(fb, 'unified_reactors', 'count'));
      if (count !== null) return count;
    }
  }
  // "count_reduced" có thể là "1.2K" — chỉ dùng khi là số nguyên thuần.
  const reduced = str(get(node, 'feedback', 'reactors', 'count_reduced'));
  return reduced && /^\d+$/.test(reduced) ? Number(reduced) : null;
}

function replyCount(node: Json): number | null {
  return (
    num(get(node, 'feedback', 'replies_fields', 'total_count')) ??
    num(get(node, 'feedback', 'replies_fields', 'count'))
  );
}

function attachmentUrls(node: Json): string[] {
  const out: string[] = [];
  const list = node.attachments;
  if (!Array.isArray(list)) return out;
  for (const att of list) {
    const media = get(att, 'style_type_renderer', 'attachment', 'media') ?? get(att, 'media');
    if (!isObj(media)) continue;
    // Bỏ ảnh xem trước của link chia sẻ (GenericAttachmentMedia) — không phải ảnh người dùng đính kèm.
    if (media.__typename === 'GenericAttachmentMedia') continue;
    const uri =
      str(get(media, 'animated_image', 'uri')) ??
      str(get(media, 'image', 'uri')) ??
      str(get(media, 'massive_image', 'uri')) ??
      str(get(media, 'sticker_image', 'uri'));
    if (uri) out.push(uri);
  }
  return out;
}

function toIso(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
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
    replyCount: replyCount(node),
    createdAt: toIso(num(node.created_time)),
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

export function extractCommentsFromJson(values: unknown[], ctx: ParseContext): CommentRecord[] {
  const out: CommentRecord[] = [];
  const fallbackParent = parentFromVariables(ctx.requestVariables);
  const stack: { value: unknown; parent: string | null }[] = values.map((value) => ({
    value,
    parent: null,
  }));
  // Duyệt bằng stack thay vì đệ quy: payload Facebook có thể rất sâu.
  while (stack.length) {
    const { value, parent } = stack.pop()!;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], parent });
      continue;
    }
    if (!isObj(value)) continue;
    let childParent = parent;
    if (isFullComment(value)) {
      const record = toRecord(value, parent, fallbackParent, ctx);
      if (record) {
        out.push(record);
        childParent = record.commentId;
      }
    }
    const keys = Object.keys(value);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i]!;
      if (BACKREF_KEYS.has(key)) continue;
      const child = value[key];
      if (typeof child === 'object' && child !== null)
        stack.push({ value: child, parent: childParent });
    }
  }
  return out;
}

export function parseFacebookPayload(raw: string, ctx: ParseContext): CommentRecord[] {
  if (!raw.includes('"Comment"')) return [];
  return extractCommentsFromJson(splitJsonPayload(raw), ctx);
}

/**
 * Tổng số bình luận Facebook báo cho bài viết: `total_count` của danh sách comment gốc
 * (object có `comments.edges` và `comments.total_count`) không nằm trong một comment.
 */
export function extractFacebookTotalCount(raw: string): number | null {
  if (!raw.includes('"total_count"')) return null;
  let best: number | null = null;
  const stack: { value: unknown; insideComment: boolean }[] = splitJsonPayload(raw).map(
    (value) => ({
      value,
      insideComment: false,
    }),
  );
  while (stack.length) {
    const { value, insideComment } = stack.pop()!;
    if (Array.isArray(value)) {
      for (const v of value) stack.push({ value: v, insideComment });
      continue;
    }
    if (!isObj(value)) continue;
    const inside = insideComment || value.__typename === 'Comment';
    const comments = value.comments;
    if (!inside && isObj(comments) && Array.isArray(comments.edges)) {
      const total = num(comments.total_count) ?? num(comments.count);
      if (total !== null) best = Math.max(best ?? 0, total);
    }
    for (const child of Object.values(value)) {
      if (typeof child === 'object' && child !== null)
        stack.push({ value: child, insideComment: inside });
    }
  }
  return best;
}
