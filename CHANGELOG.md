# Changelog

## [Unreleased]

### Added
- เชื่อมเกมกับจอ Station ของ I-Dojo LPB portal ตาม `PORTAL_INTEGRATION.md`: `utils/portalBridge.ts` ส่งผล `pass` เมื่อถูกครบ / `fail` เมื่อหมดเวลา (ผิดแต่เวลาเหลือไม่ส่ง) กันส่งซ้ำระหว่างรอ ack (10 วิ) แสดงสถานะ "กำลังส่งผล / ส่งผลแล้ว / ส่งไม่สำเร็จ [ส่งใหม่]" ใน modal ผล และส่งต่อปุ่ม Enter/Space ของวิทยากร — ทำงานเฉพาะตอนถูกฝังใน iframe
- route `GET/PUT /api/game` + ตาราง `game` เก็บชุดคำถามที่ backend และ `GET /api/admin/check` ให้ editor ตรวจรหัส
- หน้า editor ถามรหัสผู้ดูแลก่อนแก้ (เก็บใน sessionStorage) · ถ้า server ยังไม่มีชุดคำถาม ดึงข้อมูลเดิมจาก localStorage ของเครื่องนั้นมาให้ย้ายขึ้น server หรือเริ่มจากชุดตัวอย่าง F1
- เพิ่ม `PORTAL_INTEGRATION.md` สัญญาการส่งผล ผ่าน/ไม่ผ่าน (`postMessage`) เมื่อเกมถูกฝังเป็น iframe บนจอ Station ของ I-Dojo LPB portal
- เพิ่ม `CLAUDE.md` อธิบายคำสั่ง build/dev และสถาปัตยกรรม พร้อมหัวข้อ "กฎสำหรับการแก้โค้ด" อ้างอิง `DEPLOYMENT.md` และ `PORTAL_INTEGRATION.md`
- เพิ่ม `DEPLOYMENT.md` อธิบายสภาพ production บน Raspberry Pi (Apache + PM2 + MariaDB)

### Changed
- ชุดคำถามย้ายจาก localStorage ไปเก็บที่ backend — เกมใน iframe ข้ามเว็บมองไม่เห็น localStorage ของหน้า editor · ถ้าโหลดไม่ได้หรือยังไม่มีชุดคำถาม หน้าเกมแสดงข้อความแทน (ไม่ใช้ข้อมูลตัวอย่างเงียบ ๆ)
- รูปในชุดคำถามอัปโหลดขึ้น server (`/api/upload`) แล้วเก็บเป็น URL แทน base64 (ยังย่อเหลือกว้าง 900px ก่อนส่ง) รูป base64 เดิมยังใช้ได้
- `express.json` รับได้ถึง 10mb เผื่อชุดคำถามเก่าที่มีรูป base64
- Express ตัด `/I-DOJO` ออกจาก `/I-DOJO/api/...` เอง ทำให้เปิดตรง port 5000 (ไม่มี Apache) แล้วเรียก API ได้
- เว้นขอบล่างเพิ่มตอนถูกฝัง ไม่ให้ปุ่ม "ผ่านสถานี" ของ portal ทับ
- ย้ายการเสิร์ฟไฟล์อัปโหลดจาก `/uploads` และ `/I-DOJO/uploads` ไปที่ `/api/uploads` ให้ Apache บน Pi proxy ถึง และลบ proxy `/I-DOJO/uploads` ใน `vite.config.ts`

### Fixed
- สร้าง id คู่คำถามใหม่ไม่พังเมื่อเปิดผ่าน `http://<IP ของ Pi>` (`crypto.randomUUID` ใช้ไม่ได้นอก secure context)
- แก้ชื่อ env ใน `DEPLOYMENT.md` ให้ตรงกับโค้ด: `DB_PASSWORD` → `DB_PASS`, ตัด `DB_PORT` ที่โค้ดไม่ได้อ่าน, เพิ่ม `ADMIN_SECRET`

### Security
- การบันทึกชุดคำถามและอัปโหลดรูปต้องใช้ `x-admin-secret` (= `ADMIN_SECRET`) ที่ผู้ดูแลกรอกเอง ไม่ฝังใน bundle · `DELETE /api/records` ใช้ตัวตรวจเดียวกัน

### Removed
- เลิกรองรับ Netlify: ลบ `netlify.toml`, script `build:hosted`, โหมด `hosted` ใน `vite.config.ts` และ `utils/mode.ts` (`IS_HOSTED`) — basename `/I-DOJO` ตายตัว
- ลบ `VITE_ADMIN_SECRET` / `VITE_DEMO_MODE` ออกจาก `frontend/.env.example` (frontend ไม่ได้อ่านแล้ว)
