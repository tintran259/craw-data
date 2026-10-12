import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { installInterceptor } from '@/core/capture/install-interceptor';

/**
 * MAIN world, document_start. Không khai báo trong manifest mà được background đăng ký động
 * (chrome.scripting.registerContentScripts) chỉ khi đang thu thập, nên lúc người dùng lướt
 * Facebook bình thường, trang không bị can thiệp.
 */
export default defineUnlistedScript({
  // IIFE ẩn danh: không để lại biến global nào trên trang.
  globalName: false,
  main() {
    installInterceptor(window);
  },
});
