require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Fix BigInt JSON serialization
BigInt.prototype.toJSON = function () {
  return this.toString();
};

// ========== MIDDLEWARE ==========
// เปิดตรง port 5000 (ไม่มี Apache) frontend จะเรียก /I-DOJO/api/... — ตัด /I-DOJO ออกแบบเดียวกับ Apache/vite proxy
app.use((req, res, next) => {
  if (req.url.startsWith('/I-DOJO/api/')) req.url = req.url.slice('/I-DOJO'.length);
  next();
});
app.use(cors());
// ชุดคำถามเก่า/ที่ import มาอาจยังมีรูปเป็น base64 ฝังอยู่ จึงเผื่อขนาดไว้
app.use(express.json({ limit: '10mb' }));
// อยู่ใต้ /api/ เพื่อให้ Apache บน Pi proxy มาถึง (/I-DOJO/api/uploads/<file>)
// อ้างจากที่อยู่ของไฟล์นี้ ไม่ขึ้นกับว่า PM2 start จากโฟลเดอร์ไหน
const UPLOAD_DIR = path.join(__dirname, 'uploads');
app.use('/api/uploads', express.static(UPLOAD_DIR));

// งานที่แก้ข้อมูล (บันทึกชุดคำถาม, อัปโหลดรูป, ลบ records) ต้องส่ง header x-admin-secret ตรงกับ ADMIN_SECRET
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || !secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ========== Multer config ==========
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname).toLowerCase())
});

function makeUploader(exts, maxMb, kind) {
  return multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (exts.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`รองรับเฉพาะไฟล์${kind} ${exts.join(' ')} เท่านั้น`));
      }
    }
  });
}

const imageUpload = makeUploader(['.jpg', '.jpeg', '.png', '.gif', '.webp'], 10, 'รูปภาพ');
// วิดีโอสอนเก็บบน Pi เอง (จอ Station ไม่มีเน็ตออก YouTube)
const VIDEO_MAX_MB = 200;
const videoUpload = makeUploader(['.mp4', '.webm'], VIDEO_MAX_MB, 'วิดีโอ');

// error ของ multer (ไฟล์ผิดชนิด/ใหญ่เกิน) ตอบเป็น JSON 400 ให้หน้า editor แสดงข้อความได้
function single(uploader, field) {
  return (req, res, next) => {
    uploader.single(field)(req, res, (err) => {
      if (!err) return next();
      const maxMb = uploader === videoUpload ? VIDEO_MAX_MB : 10;
      const message = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${maxMb}MB` : err.message;
      res.status(400).json({ error: message });
    });
  };
}

// ลบไฟล์ใน uploads ที่ชุดคำถามไม่ได้ใช้แล้ว — เว้นไฟล์ที่เพิ่งอัปโหลดไม่ถึง 1 ชม. (อาจยังแก้ค้างอยู่ใน editor อีก tab)
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
async function removeOrphanUploads(savedJson) {
  const names = await fs.promises.readdir(UPLOAD_DIR);
  for (const name of names) {
    if (name.startsWith('.') || savedJson.includes(`/uploads/${name}`)) continue;
    const file = path.join(UPLOAD_DIR, name);
    const stat = await fs.promises.stat(file);
    if (stat.isFile() && Date.now() - stat.mtimeMs > ORPHAN_GRACE_MS) {
      await fs.promises.unlink(file);
      console.log('removed unused upload:', name);
    }
  }
}

// ========== STATIC FILE SERVING + SPA FALLBACK ==========
// ใช้ตอนรันโดยไม่มี Apache (เปิดตรง port 5000) — บน Pi ส่วนนี้ Apache เสิร์ฟจาก backend/build เอง
const BUILD_PATH = path.join(__dirname, 'build');
if (fs.existsSync(BUILD_PATH)) {
  app.use('/I-DOJO', express.static(BUILD_PATH));

  app.get('/I-DOJO', (req, res) => {
    res.sendFile(path.join(BUILD_PATH, 'index.html'));
  });
  app.get('/I-DOJO/*', (req, res) => {
    res.sendFile(path.join(BUILD_PATH, 'index.html'));
  });
}

// ========== DATABASE CONFIGURATION ==========
const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  acquireTimeout: 30000,
  timezone: '+07:00'
});

async function query(sql, params = []) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(sql, params);
    return result;
  } catch (err) {
    console.error('Database query error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// ========== DB INIT ==========
async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS records (
      id         VARCHAR(36)  NOT NULL PRIMARY KEY,
      title      VARCHAR(200) NOT NULL,
      detail     TEXT,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS app_config (
      singleton  TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
      config     TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  // ชุดคำถามของเกม (มีชุดเดียว) — data = { name, timeLimitSeconds, pairs: [SpecRecord] }
  await query(`
    CREATE TABLE IF NOT EXISTS game (
      singleton  TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
      data       MEDIUMTEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  console.log('DB ready — records, app_config & game tables ensured');
}

// ========== API ROUTES ==========
app.get('/api/records', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM records ORDER BY created_at ASC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/records error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/records', requireAdmin, async (req, res) => {
  const { title, detail } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await query(
      'INSERT INTO records (id, title, detail) VALUES (?, ?, ?)',
      [id, title, detail || '']
    );
    const [row] = await query('SELECT * FROM records WHERE id = ?', [id]);
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/records error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/records', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM records');
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/records error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/upload', requireAdmin, single(imageUpload, 'image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ filename: req.file.filename });
});

app.post('/api/upload-video', requireAdmin, single(videoUpload, 'video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ filename: req.file.filename });
});

// ให้หน้า editor ตรวจรหัสผู้ดูแลก่อนเริ่มแก้
app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/game', async (req, res) => {
  try {
    const rows = await query('SELECT data FROM game WHERE singleton = 1');
    if (rows.length === 0) return res.status(404).json({ error: 'no game' });
    res.json(JSON.parse(rows[0].data));
  } catch (err) {
    console.error('GET /api/game error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/game', requireAdmin, async (req, res) => {
  const { name, timeLimitSeconds, pairs } = req.body || {};
  if (!Array.isArray(pairs) || pairs.length < 2) {
    return res.status(400).json({ error: 'ต้องมีอย่างน้อย 2 คู่' });
  }
  try {
    const json = JSON.stringify({
      name: typeof name === 'string' ? name : '',
      timeLimitSeconds: Number.isFinite(timeLimitSeconds) ? Math.max(0, timeLimitSeconds) : 0,
      pairs,
    });
    await query(
      `INSERT INTO game (singleton, data) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW()`,
      [json]
    );
    res.json({ ok: true });
    removeOrphanUploads(json).catch((err) => console.error('removeOrphanUploads error:', err));
  } catch (err) {
    console.error('PUT /api/game error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/app-config', async (req, res) => {
  try {
    const rows = await query('SELECT config FROM app_config WHERE singleton = 1');
    if (rows.length === 0) return res.json({});
    res.json(JSON.parse(rows[0].config));
  } catch (err) {
    console.error('GET /api/app-config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/app-config', requireAdmin, async (req, res) => {
  try {
    const json = JSON.stringify(req.body);
    await query(
      `INSERT INTO app_config (singleton, config) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE config = VALUES(config), updated_at = NOW()`,
      [json]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/app-config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== START ==========
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`I-DOJO Server running on port ${PORT}`);
  initDB().catch(err => {
    console.error('DB init failed:', err.message);
    process.exit(1);
  });
});
