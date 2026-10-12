# Social Comment Exporter

Extension Chrome (Manifest V3) thu thập **toàn bộ bình luận và phản hồi** của danh sách bài viết mạng xã hội rồi xuất ra **Excel/CSV**.

- Dùng phiên đăng nhập sẵn có trên Chrome. Extension không hỏi và không lưu mật khẩu, không đọc cookie.
- Không có server. Mọi dữ liệu nằm trong trình duyệt của bạn, không có analytics hay telemetry.
- Chỉ lấy được những gì tài khoản của bạn được phép xem.

Nền tảng hỗ trợ: **Facebook** (bài trên Page, Group đã tham gia, profile cá nhân). Có thể dán link Instagram / Threads / TikTok / X: extension sẽ nhận diện được nhưng đánh dấu "chưa hỗ trợ" và bỏ qua.

## Cài đặt

Yêu cầu Node 20+, pnpm 9+, Chrome 116+.

```bash
pnpm install
pnpm build
```

1. Mở `chrome://extensions` và bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục `dist/chrome-mv3`.
3. Bấm icon extension trên thanh công cụ để mở side panel.

Mỗi lần cập nhật code: chạy `pnpm build`, rồi bấm ↻ trên thẻ extension.

## Cách dùng

1. Đăng nhập Facebook trên Chrome như bình thường.
2. Dán danh sách link vào ô **Danh sách link bài viết**, mỗi dòng một link. Extension tự bỏ dòng trống, link trùng và link không hợp lệ, có ghi lý do cho từng dòng bị bỏ.
   - Các dạng link hỗ trợ: `/posts/`, `permalink.php`, `/groups/.../posts/`, `/share/p/` (và `/share/r/`, `/share/v/`), `/photo`, `/reel/`, `/videos/`, `/watch?v=`, `story.php`.
3. Bấm **Bắt đầu thu thập**. Extension mở **một cửa sổ riêng** và lần lượt xử lý từng bài, mỗi lần một bài:
   - chuyển bộ lọc từ "Phù hợp nhất" sang "Tất cả bình luận";
   - bấm "Xem thêm bình luận" và mở từng nhánh "Xem … phản hồi";
   - cuộn trang khi cần;
   - dừng khi không còn nút tải thêm và không có dữ liệu mới trong 8 giây.
4. Theo dõi bảng **Tiến độ**: trạng thái, số bình luận, và số bình luận Facebook hiển thị để đối chiếu. Link bị lỗi có ghi lý do bằng tiếng Việt.
5. Bấm **Xuất Excel** (hoặc **Xuất CSV**). Có thể xuất bất cứ lúc nào, kể cả khi hàng đợi đang chạy.

> **Không thu nhỏ hay đóng cửa sổ thu thập** khi đang chạy. Facebook chỉ tải thêm bình luận khi trang thực sự hiển thị. Bạn vẫn có thể làm việc ở cửa sổ khác.

### File Excel

Tên file: `comments_YYYYMMDD_HHmmss.xlsx`.

- **Sheet "Bình luận"**: mỗi bình luận một dòng, gồm STT, link bài viết, nền tảng, ID bình luận, ID bình luận cha, cấp, tên, link profile, nội dung, số reaction, số phản hồi, thời gian bình luận, thời gian thu thập.
  - Reply nằm ngay dưới comment cha. Cột Nội dung có tiền tố `↳` thụt theo cấp.
  - Dòng tiêu đề in đậm và cố định, có bộ lọc, cột nội dung tự xuống dòng.
  - Thời gian hiển thị theo giờ máy, định dạng `dd/MM/yyyy HH:mm:ss`.
- **Sheet "Tổng quan"**: mỗi link một dòng, gồm trạng thái, số comment gốc, số reply, tổng, số Facebook hiển thị, thời gian bắt đầu/kết thúc, ghi chú lỗi.

File CSV dùng UTF-8 có BOM nên mở bằng Excel không lỗi font tiếng Việt. Ô bắt đầu bằng `=`, `+`, `-` hoặc `@` được thêm dấu `'` ở đầu để Excel không chạy nó như công thức.

### Tạm dừng, tiếp tục, hủy, bị chặn

- **Tạm dừng**: bài đang chạy quay về "Chờ". Bình luận đã thu vẫn giữ và được gộp lại khi chạy tiếp.
- **Hủy**: các bài chưa chạy chuyển sang "Bỏ qua", dữ liệu đã thu vẫn xuất được.
- Nếu Facebook báo **thao tác quá nhanh, checkpoint hoặc yêu cầu đăng nhập**, toàn bộ hàng đợi **dừng lại**, không tự thử lại. Hãy xử lý trong cửa sổ thu thập rồi bấm **Tiếp tục**: bài vừa lỗi sẽ được chạy lại.
- Bài không tồn tại hoặc không có quyền xem chỉ bị đánh lỗi riêng, các bài sau vẫn chạy tiếp.
- Có thể đóng side panel bất cứ lúc nào, hàng đợi vẫn chạy. Nếu Chrome tắt service worker hoặc khởi động lại, hàng đợi tự chạy tiếp từ đúng vị trí.

### Cài đặt

| Mục                   | Mặc định  | Ghi chú                                      |
| --------------------- | --------- | -------------------------------------------- |
| Trễ giữa các thao tác | 1–3 giây  | ngẫu nhiên, tối thiểu 0,5 giây               |
| Nghỉ giữa các bài     | 5–15 giây | ngẫu nhiên, tối thiểu 2 giây                 |
| Số bài tối đa mỗi giờ | 30        | vượt quá thì tự chờ                          |
| Timeout mỗi bài       | 10 phút   | quá hạn thì báo lỗi nhưng giữ dữ liệu đã thu |
| Lấy phản hồi (reply)  | Có        |                                              |
| Debug mode            | Tắt       | xem mục Debug                                |

Không có chế độ "chạy nhanh bỏ qua delay".

## Quyền (permissions) và lý do

| Quyền                             | Dùng để                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sidePanel`                       | Hiển thị giao diện ở side panel (popup tự đóng khi mất focus nên không dùng).                                            |
| `storage`                         | Lưu cài đặt, trạng thái hàng đợi (để chạy tiếp sau khi service worker bị tắt).                                           |
| `tabs`                            | Mở bài viết trong cửa sổ thu thập, chuyển sang bài tiếp theo, biết khi cửa sổ bị đóng.                                   |
| `scripting`                       | Đăng ký script đọc dữ liệu **chỉ khi đang thu thập**, gỡ khi xong. Lúc rảnh, extension không chèn gì vào trang Facebook. |
| `downloads`                       | Tải file Excel/CSV/debug về máy.                                                                                         |
| `alarms`                          | Hẹn giờ nghỉ giữa bài, giới hạn mỗi giờ và timeout, vẫn đúng giờ khi Chrome tắt service worker.                          |
| `https://*.facebook.com/*` (host) | Đọc dữ liệu bình luận trên trang Facebook. Chỉ khai báo đúng domain của nền tảng đang hỗ trợ.                            |

## Cách hoạt động

```
Side panel (React) ──runtime messaging──► Background service worker
                                             │ hàng đợi, rate limit, lưu trạng thái (storage + IndexedDB)
                                             ▼ mở bài trong cửa sổ thu thập
                         Content script (isolated) ── tự động bấm/cuộn, parse, gửi bình luận về
                                             ▲ window.postMessage (raw text)
                         Interceptor (MAIN world, document_start) ── hook fetch/XHR /api/graphql/
```

- Lô bình luận đầu tiên được đọc từ JSON nhúng trong HTML (`<script type="application/json">`). Các lô sau đến từ response GraphQL mà interceptor bắt được (chỉ clone và đọc, không sửa response).
- Parser duyệt toàn bộ cây JSON để tìm node `__typename: "Comment"`, không bám vào một đường dẫn cố định. Reply được gắn với comment cha theo cấu trúc lồng nhau, theo `comment_direct_parent`, hoặc theo `variables` của request.
- Bình luận được khử trùng lặp theo `platform + commentId`.
- Body của request GraphQL (có token `fb_dtsg`) không bao giờ rời khỏi trang.

## Debug mode

Dùng khi Facebook đổi cấu trúc và extension không lấy được bình luận:

1. Bật **Cài đặt → Debug mode**.
2. Cách 1: chạy hàng đợi như bình thường. Raw dữ liệu của từng bài được lưu lại.
   Cách 2: dán một link vào khung **Ghi dữ liệu debug** rồi bấm **Mở & ghi**.
3. Bấm **Tải dữ liệu debug** để nhận file `debug_*.json`. File có URL request, tên operation (`fb_api_req_friendly_name`), `doc_id`, `variables`, timestamp và raw text. File **không** chứa token hay cookie, nhưng **có** nội dung bình luận và tên người bình luận.

## Giới hạn đã biết

- Bình luận bị ẩn, bị xóa, bị Facebook lọc là spam, hoặc của người đã chặn bạn sẽ không lấy được.
- Thao tác tự động dựa vào nhãn nút tiếng Việt và tiếng Anh. Với giao diện ngôn ngữ khác, extension vẫn lấy được lô bình luận đầu nhưng có thể không tự bấm tải thêm.
- Facebook thay đổi giao diện và cấu trúc dữ liệu thường xuyên. Khi số bình luận thu được lệch nhiều so với số Facebook hiển thị, hãy bật Debug mode và gửi file debug để cập nhật parser.
- Số "Facebook hiển thị" là `total_count` do Facebook báo, có thể đã gồm cả bình luận bị ẩn.
- Mẫu GraphQL của phần "tải thêm/reply" trong test hiện là **mẫu tổng hợp** (`__fixtures__/*.synthetic.txt`) dựng theo cấu trúc node thật. Nên bổ sung fixture thật khi có file debug chứa các response này.

## Phát triển

```bash
pnpm dev        # chạy WXT dev (tự reload)
pnpm test       # Vitest
pnpm lint       # ESLint
pnpm compile    # kiểm tra kiểu TypeScript
pnpm build      # build vào dist/chrome-mv3
```

Cấu trúc chính:

```
src/
  entrypoints/       background.ts · content.ts · interceptor.ts · sidepanel/
  core/              queue/ · storage/ · messaging/ · export/ · capture/ · dedupe.ts
  adapters/          types.ts · registry.ts · intercept-targets.ts · facebook/ · instagram/ ...
  shared/            url.ts · errors.ts · utils/ (delay, logger, time)
```

### Thêm nền tảng mới

Core (hàng đợi, lưu trữ, xuất file, UI) chỉ dùng interface `PlatformAdapter` trong `src/adapters/types.ts`. Để thêm một nền tảng, ví dụ Instagram:

1. Trong `src/adapters/instagram/`, implement `PlatformAdapter`: `matchUrl`, `normalizeUrl`, `isTargetRequest`, `describeRequest`, `parsePayload`, `parseInitialHtml`, `extractTotalCount`, `loadAllComments`, `detectBlock`, `contentScriptMatches`, `interceptTargets`.
2. Đăng ký adapter trong `ADAPTERS` ở `src/adapters/registry.ts`.
3. Thêm endpoint cần bắt vào `src/adapters/intercept-targets.ts`.
4. Thêm host vào `host_permissions` (`wxt.config.ts`) và `matches` của `src/entrypoints/content.ts`.
5. Bật Debug mode, thu file mẫu thật, tạo fixture trong `__fixtures__/` và viết test cho parser **trước** khi dùng thật.
