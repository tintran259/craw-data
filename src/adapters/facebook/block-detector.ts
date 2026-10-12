import type { BlockReason } from '@/adapters/types';

const RATE_LIMIT = [
  /you(['’]re| are) temporarily blocked/i,
  /going too fast/i,
  /misusing this feature/i,
  /tạm thời bị chặn/i,
  /quá nhanh/i,
  /sử dụng sai tính năng/i,
];

const UNAVAILABLE = [
  /this content isn['’]t available/i,
  /content isn['’]t available right now/i,
  /this page isn['’]t available/i,
  /nội dung này hiện không (khả dụng|có sẵn|hiển thị)/i,
  /bạn hiện không xem được nội dung này/i,
  /trang này hiện không khả dụng/i,
];

function textOf(el: Element | null, limit = 4000): string {
  return (el?.textContent ?? '').slice(0, limit);
}

/**
 * Phát hiện trang bị hạn chế. `rate_limited`, `checkpoint`, `login_required` làm dừng toàn bộ
 * hàng đợi; `unavailable` chỉ đánh lỗi link hiện tại.
 */
export function detectFacebookBlock(doc: Document): BlockReason | null {
  const loc = doc.location;
  const path = loc?.pathname ?? '';
  if (path.startsWith('/checkpoint')) {
    return {
      code: 'checkpoint',
      message:
        'Facebook yêu cầu xác minh tài khoản (checkpoint). Hãy xử lý trong cửa sổ thu thập rồi bấm Tiếp tục.',
    };
  }
  if (
    /^\/login(\.php|\/|$)/.test(path) ||
    doc.querySelector('form#login_form, form[action*="/login"] input[name="pass"]')
  ) {
    return {
      code: 'login_required',
      message: 'Facebook yêu cầu đăng nhập. Hãy đăng nhập Facebook trên Chrome rồi bấm Tiếp tục.',
    };
  }

  const dialogs = doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"]');
  for (const el of dialogs) {
    const text = textOf(el);
    if (RATE_LIMIT.some((re) => re.test(text))) {
      return {
        code: 'rate_limited',
        message:
          'Facebook cảnh báo bạn đang thao tác quá nhanh / tạm thời bị chặn. Đã dừng hàng đợi — hãy nghỉ một thời gian rồi tăng độ trễ trong Cài đặt.',
      };
    }
  }

  // Chỉ kiểm tra "không khả dụng" khi trang không có bình luận nào, để tránh nhầm với nội dung bình luận.
  if (!doc.querySelector('[role="article"]')) {
    const text = textOf(doc.querySelector('[role="main"]') ?? doc.body);
    if (UNAVAILABLE.some((re) => re.test(text))) {
      return {
        code: 'unavailable',
        message: 'Bài viết không tồn tại, đã bị xóa hoặc tài khoản của bạn không có quyền xem.',
      };
    }
  }
  return null;
}
