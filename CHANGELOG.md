# Changelog

## [Unreleased]

### Added
- เพิ่ม `CLAUDE.md` อธิบายคำสั่ง build/dev, โหมด deploy สองแบบ (`/I-DOJO/` กับ Netlify) และโครงสร้างการเก็บข้อมูลเกมใน localStorage พร้อมหัวข้อ "กฎสำหรับการแก้โค้ด" อ้างอิง `DEPLOYMENT.md`
- เพิ่ม `DEPLOYMENT.md` อธิบายสภาพ production บน Raspberry Pi (Apache + PM2 + MariaDB)

### Changed
- ย้ายการเสิร์ฟไฟล์อัปโหลดจาก `/uploads` และ `/I-DOJO/uploads` ไปที่ `/api/uploads` ให้ Apache บน Pi proxy ถึง และลบ proxy `/I-DOJO/uploads` ใน `vite.config.ts`
- `IS_HOSTED` ดูจาก Vite mode `hosted` ด้วย ทำให้ `build:hosted` ได้ basename `/` ถูกต้อง (บน Pi ยังเป็น `/I-DOJO` เหมือนเดิม)
- เพิ่ม `VITE_DEMO_MODE` (comment) ใน `frontend/.env.example`

### Fixed
- แก้ชื่อ env ใน `DEPLOYMENT.md` ให้ตรงกับโค้ด: `DB_PASSWORD` → `DB_PASS`, ตัด `DB_PORT` ที่โค้ดไม่ได้อ่าน, เพิ่ม `ADMIN_SECRET`
