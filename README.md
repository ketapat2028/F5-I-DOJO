# I-DOJO

โครงสร้างโปรเจกต์นี้อ้างอิงจาก mecha1-team-building: แยก `frontend` (React + Vite + Tailwind) กับ `backend` (Node/Express + MariaDB) และมี `gas/Code.gs` สำหรับเชื่อมต่อ Google Apps Script แยกส่วนกัน

## โครงสร้าง

```
i-dojo/
├── backend/            Node.js + Express API
│   ├── index.js
│   ├── package.json
│   └── .env.example
├── frontend/           React + Vite + TypeScript + Tailwind
│   └── src/
│       ├── main.tsx
│       ├── styles/
│       └── app/
│           ├── App.tsx
│           ├── routes.tsx
│           ├── components/
│           │   └── ui/        UI primitives (button, card, input, ...)
│           ├── pages/         HomePage, DashboardPage
│           └── utils/         apiClient, mode
├── gas/
│   └── Code.gs         Google Apps Script template
└── netlify.toml
```

## เริ่มใช้งาน

### Backend
```
cd backend
cp .env.example .env   # ตั้งค่า DB ของตัวเอง
npm install
npm run dev             # http://localhost:5000
```

### Frontend
```
cd frontend
npm install
npm run dev              # http://localhost:5173
```

ตัวอย่าง API ที่ให้มา (`/api/records`, `/api/app-config`, `/api/upload`) เป็น placeholder — แก้ schema/endpoint ใน `backend/index.js` และหน้า `frontend/src/app/pages/DashboardPage.tsx` ให้ตรงกับโดเมนจริงของ i-dojo ได้เลย
