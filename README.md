# iData Scan Sync

Trang web đơn giản để quét mã trên máy iData rồi đồng bộ realtime sang trình
duyệt trên PC (hoặc bất kỳ thiết bị nào khác), dùng để lấy MVĐ ra máy tính xử lý.

Stack: 1 Cloudflare Worker + 1 Durable Object (giữ trạng thái từng "phòng"),
frontend là HTML/JS thuần (không cần build step) nên deploy xong là dùng được
ngay, không cần dựng thêm gì khác.

## 1. Cài đặt

Cần có Node.js (>=18) và một tài khoản Cloudflare (free tier là đủ).

```bash
cd idata-scan-sync
npm install
```

## 2. Đăng nhập Cloudflare

```bash
npx wrangler login
```

Lệnh này sẽ mở trình duyệt để bạn đăng nhập/ủy quyền cho Wrangler.

## 3. Deploy

```bash
npx wrangler deploy
```

Sau khi chạy xong, Wrangler sẽ in ra 1 URL dạng:

```
https://idata-scan-sync.<your-subdomain>.workers.dev
```

Đây là link bạn sẽ mở trên cả PC và máy iData (cần cả 2 có mạng để truy cập
được URL này — không nhất thiết phải cùng WiFi, vì đây là domain public trên
Cloudflare, không phải chạy local).

> Muốn thử trước khi deploy thật? `npx wrangler dev` chạy được ở local,
> nhưng máy iData sẽ khó truy cập vào localhost của máy bạn trừ khi cùng
> mạng LAN và bạn tự mở port — nên cách nhanh nhất để test 2 thiết bị là
> deploy thẳng lên Workers luôn, vẫn miễn phí trong hạn mức free tier.

## 4. Cấu hình scanner trên máy iData

Vào Settings của máy iData → tìm mục cấu hình scanner (thường là
"Scan Settings" / "Output Method") → chọn chế độ **Keyboard Emulation**
(giả lập bàn phím) thay vì Broadcast Intent hoặc app riêng. Nếu có tùy chọn
"Suffix" / "End character", chọn **Enter** — để mỗi lần quét xong, trang
web tự nhận mã ngay không cần bấm gì thêm.

## 5. Test luồng

1. **Trên PC:** mở URL vừa deploy → bấm "Tạo phòng mới (PC)" → sẽ được
   chuyển tới `/r/ABC123` với mã phòng 6 ký tự hiện to ở đầu trang.
2. **Trên iData:** mở cùng URL gốc → nhập đúng mã phòng đó → bấm "Vào".
3. Cả 2 màn hình giờ đã join chung 1 "phòng", kết nối qua WebSocket.
4. Trên iData, chạm vào ô input (tự động focus sẵn) rồi quét mã — mã sẽ
   tự "gõ" vào ô input và tự Enter, gửi lên server.
5. Cả 2 màn hình (PC và iData) đều thấy mã mới xuất hiện ngay trong 1 danh
   sách đơn giản (đánh số thứ tự). Quét lại 1 mã đã có sẵn sẽ bị bỏ qua
   hoàn toàn — không thêm dòng mới, không có dấu hiệu gì đặc biệt.
6. **Copy danh sách:** copy toàn bộ mã (mỗi mã 1 dòng) vào clipboard, báo
   "Đã copy N mã".
7. **Xóa danh sách:** xóa hết mã trong phòng (có hỏi xác nhận trước), cả 2
   màn hình đồng bộ về danh sách trống.
8. **Đóng phòng:** hỏi xác nhận, sau đó mọi thiết bị đang trong phòng sẽ
   thấy màn hình "Phòng đã đóng" và không thể quét thêm nữa; dữ liệu phòng
   bị xóa hẳn khỏi server.

## Ghi chú

- Phòng tự động bị xoá dữ liệu sau **24 giờ không hoạt động** (không có mã
  quét mới) để không tích rác trong Durable Object storage — tương tự như
  khi bấm "Đóng phòng" thủ công.
- Nếu vào lại đúng 1 mã phòng đã bị đóng/hết hạn, hệ thống sẽ coi như 1
  phòng trống mới (không báo lỗi) — vì dữ liệu cũ đã bị xóa hẳn.
- Mã phòng chỉ có 6 ký tự (bỏ các ký tự dễ nhầm như 0/O, 1/I) nên gõ tay
  trên iData cũng nhanh nếu không copy-paste được.
- File `src/worker.js` chứa cả HTML/CSS/JS của 2 trang (landing + room) dạng
  chuỗi để không cần thêm bước build frontend — deploy 1 lệnh là xong. Nếu
  sau này muốn nâng cấp UI bằng Vue/Nuxt như các project JMS khác của bạn,
  có thể tách phần frontend ra build riêng rồi trỏ Worker vào static assets.
