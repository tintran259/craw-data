import type { CommentRecord, ParseContext } from '@/adapters/types';
import { parseFacebookPayload } from './parser';

/** Lô comment đầu tiên nằm trong các thẻ `<script type="application/json">` của HTML. */
export function parseFacebookInitialHtml(doc: Document, ctx: ParseContext): CommentRecord[] {
  const out: CommentRecord[] = [];
  doc.querySelectorAll('script[type="application/json"]').forEach((el) => {
    const text = el.textContent;
    if (text && text.includes('"Comment"')) out.push(...parseFacebookPayload(text, ctx));
  });
  return out;
}

export function facebookInitialHtmlTotalCount(
  doc: Document,
  extract: (raw: string) => number | null,
): number | null {
  let best: number | null = null;
  doc.querySelectorAll('script[type="application/json"]').forEach((el) => {
    const n = el.textContent ? extract(el.textContent) : null;
    if (n !== null) best = Math.max(best ?? 0, n);
  });
  return best;
}
