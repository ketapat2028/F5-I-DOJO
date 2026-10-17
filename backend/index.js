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
app.use(cors());
app.use(express.json());
// อยู่ใต้ /api/ เพื่อให้ Apache บน Pi proxy มาถึง (/I-DOJO/api/uploads/<file>)
app.use('/api/uploads', express.static('uploads'));

// ========== Multer config ==========
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('รองรับเฉพาะไฟล์รูปภาพ .jpg .jpeg .png .gif .webp เท่านั้น'));
    }
  }
});

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
  console.log('DB ready — records & app_config tables ensured');
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

app.post('/api/records', async (req, res) => {
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

app.delete('/api/records', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await query('DELETE FROM records');
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/records error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ filename: req.file.filename });
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

app.post('/api/app-config', async (req, res) => {
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
