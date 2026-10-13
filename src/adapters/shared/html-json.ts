/**
 * Nội dung các khối `<script type="application/json">` có chứa một trong các `markers` —
 * Facebook, Instagram, Threads (cùng nền Relay của Meta) nhúng lô dữ liệu đầu tiên vào HTML.
 */
export function htmlJsonBlocks(doc: Document, markers: string | (string | null)[]): string[] {
  const list = (Array.isArray(markers) ? markers : [markers]).filter((m): m is string => !!m);
  const out: string[] = [];
  doc.querySelectorAll('script[type="application/json"]').forEach((el) => {
    const text = el.textContent;
    if (text && list.some((m) => text.includes(m))) out.push(text);
  });
  return out;
}
