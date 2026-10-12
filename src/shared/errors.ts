/** Chuyển lỗi bất kỳ thành thông điệp tiếng Việt dễ hiểu để hiển thị trên side panel. */
export function toUserMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      return 'Không kết nối được tới tab đang xử lý. Hãy thử lại.';
    }
    if (/No tab with id/i.test(msg)) return 'Tab xử lý đã bị đóng.';
    if (/QuotaExceeded/i.test(msg))
      return 'Bộ nhớ trình duyệt đã đầy. Hãy xuất và xóa bớt dữ liệu.';
    return msg || 'Đã xảy ra lỗi không xác định.';
  }
  if (typeof err === 'string' && err) return err;
  return 'Đã xảy ra lỗi không xác định.';
}
