/** Tiện ích đọc JSON không có schema (payload mạng xã hội đổi cấu trúc thường xuyên). */

export type Json = Record<string, unknown>;

export const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Chuỗi khác rỗng; số nguyên cũng được chuyển thành chuỗi (id dạng số). */
export const str = (v: unknown): string | null =>
  typeof v === 'string' && v
    ? v
    : typeof v === 'number' && Number.isSafeInteger(v)
      ? String(v)
      : null;

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const get = (o: unknown, ...path: string[]): unknown => {
  let cur = o;
  for (const key of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
};

/** Giây (Unix) hoặc chuỗi ngày → ISO 8601. */
export function toIsoTime(v: unknown): string | null {
  const seconds = num(v);
  if (seconds !== null) return new Date(seconds * 1000).toISOString();
  if (typeof v === 'string' && v) {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return null;
}

export interface WalkFrame {
  value: Json;
  /** Khóa chứa object này ở object cha (phần tử mảng nhận khóa của mảng). */
  key: string | null;
  /** Giá trị do `visit` của tổ tiên gần nhất truyền xuống (vd. id comment cha). */
  inherited: string | null;
}

/**
 * Duyệt mọi object trong cây JSON theo thứ tự xuất hiện (bằng stack, không đệ quy: payload có thể
 * rất sâu). `visit` trả về giá trị truyền xuống cho con (undefined = giữ giá trị cũ),
 * hoặc `false` để không đi vào nhánh này.
 */
export function walkJson(
  roots: unknown[],
  visit: (frame: WalkFrame) => string | null | undefined | false,
): void {
  type Item = { value: unknown; key: string | null; inherited: string | null };
  const stack: Item[] = [];
  const pushChildren = (value: unknown, key: string | null, inherited: string | null) => {
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], key, inherited });
    } else if (isObj(value)) {
      const keys = Object.keys(value);
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i]!;
        const child = value[k];
        if (typeof child === 'object' && child !== null) {
          stack.push({ value: child, key: k, inherited });
        }
      }
    }
  };
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ value: roots[i], key: null, inherited: null });
  }
  while (stack.length) {
    const { value, key, inherited } = stack.pop()!;
    if (Array.isArray(value)) {
      pushChildren(value, key, inherited);
      continue;
    }
    if (!isObj(value)) continue;
    const result = visit({ value, key, inherited });
    if (result === false) continue;
    pushChildren(value, null, result === undefined ? inherited : result);
  }
}
