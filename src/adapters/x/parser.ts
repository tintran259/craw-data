import type { CommentRecord, ParseContext } from '@/adapters/types';
import { get, isObj, num, str, toIsoTime, walkJson, type Json } from '@/adapters/shared/json';
import { splitJsonPayload } from '@/adapters/shared/payload-splitter';
import { xStatusId } from './url';

/**
 * X trả hội thoại qua GraphQL `TweetDetail`:
 * `threaded_conversation_with_injections_v2.instructions[].entries[]` → `tweet_results.result`
 * = `{__typename: 'Tweet', rest_id, core.user_results.result, legacy{full_text, created_at,
 * favorite_count, reply_count, in_reply_to_status_id_str}}` (đôi khi bọc trong
 * `TweetWithVisibilityResults.tweet`). Bình luận = tweet trả lời và MỚI HƠN tweet gốc
 * (id X tăng theo thời gian) — loại được các tweet phía trên mà tweet gốc đang trả lời.
 */

/** Tweet được trích dẫn / retweet nằm trong tweet khác — không phải bình luận. */
const SKIP_KEYS = new Set(['quoted_status_result', 'retweeted_status_result']);

function tweetOf(o: Json): Json | null {
  // Tweet bên trong lớp bọc thường không có __typename.
  if (o.__typename === 'TweetWithVisibilityResults') return isObj(o.tweet) ? o.tweet : null;
  return o.__typename === 'Tweet' && str(o.rest_id) && isObj(o.legacy) ? o : null;
}

function newerThan(id: string, other: string): boolean {
  try {
    return BigInt(id) > BigInt(other);
  } catch {
    return false;
  }
}

function userOf(tweet: Json): { name: string; screenName: string | null; id: string | null } {
  const user = get(tweet, 'core', 'user_results', 'result');
  // Schema mới (2025) chuyển tên sang `core`; schema cũ nằm trong `legacy`.
  const screenName =
    str(get(user, 'core', 'screen_name')) ?? str(get(user, 'legacy', 'screen_name'));
  const name = str(get(user, 'core', 'name')) ?? str(get(user, 'legacy', 'name'));
  return { name: name ?? screenName ?? '', screenName, id: str(get(user, 'rest_id')) };
}

/** Bỏ phần "@a @b " đầu tweet (tiền tố trả lời) theo `display_text_range` (đếm theo code point). */
function displayText(tweet: Json): string {
  const note = str(get(tweet, 'note_tweet', 'note_tweet_results', 'result', 'text'));
  if (note) return note;
  const legacy = tweet.legacy as Json;
  const full = str(legacy.full_text) ?? '';
  const range = legacy.display_text_range;
  const start = Array.isArray(range) ? num(range[0]) : null;
  return start ? Array.from(full).slice(start).join('') : full;
}

function mediaOf(legacy: Json): string[] {
  const media = get(legacy, 'extended_entities', 'media');
  if (!Array.isArray(media)) return [];
  return media.map((m) => str(get(m, 'media_url_https'))).filter((u): u is string => !!u);
}

export function parseXPayload(raw: string, ctx: ParseContext): CommentRecord[] {
  if (!raw.includes('"rest_id"')) return [];
  const focalId = xStatusId(ctx.postUrl);
  const out: CommentRecord[] = [];
  const seen = new Set<string>();
  walkJson(splitJsonPayload(raw), ({ value: o, key }) => {
    if (key && SKIP_KEYS.has(key)) return false;
    const tweet = tweetOf(o);
    if (!tweet) return undefined;
    const id = str(tweet.rest_id)!;
    const legacy = tweet.legacy as Json;
    const replyTo = str(legacy.in_reply_to_status_id_str);
    const isComment = !!replyTo && id !== focalId && (!focalId || newerThan(id, focalId));
    if (!isComment || seen.has(id)) return false;
    seen.add(id);
    const user = userOf(tweet);
    const parentId = replyTo === focalId ? null : replyTo;
    out.push({
      postUrl: ctx.postUrl,
      platform: 'x',
      commentId: id,
      parentId,
      // X không cho biết độ sâu; reply của reply ghi là cấp 1 (cột "ID cha" vẫn đúng).
      depth: parentId ? 1 : 0,
      authorName: user.name,
      authorId: user.id,
      authorProfileUrl: user.screenName ? `https://x.com/${user.screenName}` : null,
      content: displayText(tweet),
      attachmentUrls: mediaOf(legacy),
      reactionCount: num(legacy.favorite_count),
      replyCount: num(legacy.reply_count),
      createdAt: toIsoTime(legacy.created_at),
      crawledAt: ctx.crawledAt,
    });
    return false;
  });
  return out;
}

/** `reply_count` của tweet gốc. */
export function extractXTotalCount(raw: string, postUrl?: string): number | null {
  const focalId = postUrl ? xStatusId(postUrl) : null;
  if (!focalId || !raw.includes(focalId)) return null;
  let best: number | null = null;
  walkJson(splitJsonPayload(raw), ({ value: o }) => {
    const tweet = tweetOf(o);
    if (tweet && str(tweet.rest_id) === focalId) {
      const count = num(get(tweet, 'legacy', 'reply_count'));
      if (count !== null) best = Math.max(best ?? 0, count);
    }
    return undefined;
  });
  return best;
}
