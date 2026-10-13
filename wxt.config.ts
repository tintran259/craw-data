import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // Thư mục build không bắt đầu bằng dấu chấm để Finder/Chrome không ẩn.
  outDir: 'dist',
  // Dùng import tường minh thay cho auto-import để ESLint/tsc đọc code dễ hơn.
  imports: false,
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    // exceljs (~1MB) được tách chunk riêng và chỉ tải khi xuất file.
    build: { chunkSizeWarningLimit: 1200 },
  }),
  manifest: {
    name: 'Social Comment Exporter',
    description:
      'Thu thập bình luận từ bài viết mạng xã hội và xuất Excel. Chạy hoàn toàn trên trình duyệt, không gửi dữ liệu ra ngoài.',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage', 'tabs', 'scripting', 'downloads', 'alarms'],
    host_permissions: [
      'https://*.facebook.com/*',
      'https://*.instagram.com/*',
      'https://*.threads.com/*',
      'https://*.threads.net/*',
      'https://x.com/*',
      'https://*.x.com/*',
      'https://*.twitter.com/*',
    ],
    action: {
      default_title: 'Mở Social Comment Exporter',
    },
  },
});
