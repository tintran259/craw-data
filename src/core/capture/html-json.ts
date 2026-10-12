/** Lọc khối JSON nhúng có khả năng chứa bình luận, để file debug không quá lớn. */
const RELEVANT = /comment|feedback/i;

export interface HtmlJsonBlocks {
  blocks: string[];
  skipped: number;
}

/** Lấy nội dung các thẻ `<script type="application/json">` có liên quan tới bình luận. */
export function collectHtmlJsonBlocks(doc: Document): HtmlJsonBlocks {
  const blocks: string[] = [];
  let skipped = 0;
  doc.querySelectorAll('script[type="application/json"]').forEach((el) => {
    const text = el.textContent;
    if (!text) return;
    if (RELEVANT.test(text)) blocks.push(text);
    else skipped++;
  });
  return { blocks, skipped };
}
