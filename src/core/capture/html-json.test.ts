import { describe, expect, it } from 'vitest';
import { collectHtmlJsonBlocks } from './html-json';

describe('collectHtmlJsonBlocks', () => {
  it('chỉ giữ khối JSON liên quan tới bình luận', () => {
    document.body.innerHTML = `
      <script type="application/json">{"require":[["x",{"comment_count":1}]]}</script>
      <script type="application/json">{"unrelated":true}</script>
      <script type="application/json"></script>
      <script>var notJson = "comment";</script>
      <script type="application/json">{"feedback":{"id":"1"}}</script>`;
    const result = collectHtmlJsonBlocks(document);
    expect(result.blocks).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });
});
