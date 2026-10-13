/** Kết quả lần tách gần nhất: cùng một response được parser, bộ đếm tổng và pager đọc lần lượt. */
let lastRaw: string | null = null;
let lastValues: unknown[] = [];

/**
 * Tách một response thành các giá trị JSON. Xử lý được:
 * - tiền tố chống JSON hijacking `for (;;);`
 * - nhiều object JSON nối tiếp (mỗi dòng một object, hoặc dính liền nhau)
 * Phần không parse được bị bỏ qua, không throw.
 * Kết quả được dùng chung giữa các lần gọi liên tiếp với cùng `raw` — chỉ đọc, không sửa.
 */
export function splitJsonPayload(raw: string): unknown[] {
  if (raw === lastRaw) return lastValues;
  lastValues = splitUncached(raw);
  lastRaw = raw;
  return lastValues;
}

function splitUncached(raw: string): unknown[] {
  const text = raw.replace(/^\s*for\s*\(;;\);/, '');
  const out: unknown[] = [];

  // Đường nhanh: mỗi dòng là một JSON hoàn chỉnh (trường hợp phổ biến nhất).
  const lines = text.split('\n').filter((l) => l.trim());
  let allLinesOk = true;
  const lineValues: unknown[] = [];
  for (const line of lines) {
    try {
      lineValues.push(JSON.parse(line));
    } catch {
      allLinesOk = false;
      break;
    }
  }
  if (allLinesOk) return lineValues;

  // Đường chậm: quét ký tự, cắt theo cặp ngoặc cân bằng ngoài chuỗi.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      if (depth > 0) inString = true;
    } else if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if ((ch === '}' || ch === ']') && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* bỏ qua khối hỏng */
        }
        start = -1;
      }
    }
  }
  return out;
}
