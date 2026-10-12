const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** `YYYYMMDD_HHmmss` theo giờ máy, dùng cho tên file. */
export function fileTimestamp(date = new Date()): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** `dd/MM/yyyy HH:mm:ss` theo giờ máy. Trả về chuỗi rỗng nếu không hợp lệ. */
export function formatDisplayTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
