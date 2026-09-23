// Family Schedule — Express server
// Storage: Postgres when DATABASE_URL is set (recommended on Render free tier),
// otherwise SQLite on disk (great locally, or on Railway with a volume).

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Storage layer: one tiny async interface, two drivers
// ---------------------------------------------------------------------------
let db; // { all(sql, params), get(sql, params), run(sql, params) -> { lastID } }

async function initDb() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
    });
    // translate '?' placeholders to $1, $2, ...
    const q = (sql, params = []) => {
      let i = 0;
      return pool.query(sql.replace(/\?/g, () => `$${++i}`), params);
    };
    db = {
      all: async (sql, p) => (await q(sql, p)).rows,
      get: async (sql, p) => (await q(sql, p)).rows[0],
      run: async (sql, p) => {
        const isInsert = /^\s*insert/i.test(sql);
        const r = await q(isInsert ? sql + ' RETURNING id' : sql, p);
        return { lastID: isInsert ? r.rows[0].id : undefined };
      }
    };
    await q(`CREATE TABLE IF NOT EXISTS members (
               id SERIAL PRIMARY KEY,
               name TEXT NOT NULL,
               color TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS events (
               id SERIAL PRIMARY KEY,
               member_id INTEGER,
               title TEXT NOT NULL,
               date TEXT NOT NULL,
               start_time TEXT,
               end_time TEXT,
               notes TEXT)`);
    console.log('Storage: Postgres');
  } else {
    const Database = require('better-sqlite3');
    const file = process.env.DB_PATH || path.join(__dirname, 'data', 'schedule.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sq = new Database(file);
    sq.pragma('journal_mode = WAL');
    sq.exec(`CREATE TABLE IF NOT EXISTS members (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL,
               color TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS events (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               member_id INTEGER,
               title TEXT NOT NULL,
               date TEXT NOT NULL,
               start_time TEXT,
               end_time TEXT,
               notes TEXT);`);
    db = {
      all: async (sql, p = []) => sq.prepare(sql).all(...p),
      get: async (sql, p = []) => sq.prepare(sql).get(...p),
      run: async (sql, p = []) => ({ lastID: sq.prepare(sql).run(...p).lastInsertRowid })
    };
    console.log('Storage: SQLite at ' + file);
  }
}

// ---------------------------------------------------------------------------
// Optional shared passcode (set FAMILY_PASSWORD to turn it on)
// ---------------------------------------------------------------------------
const PASSWORD = process.env.FAMILY_PASSWORD || '';
const TOKEN = PASSWORD
  ? crypto.createHmac('sha256', PASSWORD).update('family-schedule-session').digest('hex')
  : '';

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

app.get('/api/session', (req, res) => {
  const authed = !PASSWORD || cookies(req).fam === TOKEN;
  res.json({ locked: !!PASSWORD, authed });
});

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  const given = String(req.body.password || '');
  const a = Buffer.from(given), b = Buffer.from(PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Wrong passcode' });
  res.setHeader('Set-Cookie',
    `fam=${TOKEN}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/session' || req.path === '/login') return next();
  if (PASSWORD && cookies(req).fam !== TOKEN) {
    return res.status(401).json({ error: 'Locked' });
  }
  next();
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
app.get('/api/members', async (req, res) => {
  res.json(await db.all('SELECT * FROM members ORDER BY id'));
});

app.post('/api/members', async (req, res) => {
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'Name and color are required' });
  const r = await db.run('INSERT INTO members (name, color) VALUES (?, ?)', [name.trim(), color]);
  res.status(201).json(await db.get('SELECT * FROM members WHERE id = ?', [r.lastID]));
});

app.delete('/api/members/:id', async (req, res) => {
  const id = Number(req.params.id);
  await db.run('UPDATE events SET member_id = NULL WHERE member_id = ?', [id]);
  await db.run('DELETE FROM members WHERE id = ?', [id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Events  (date = 'YYYY-MM-DD', times = 'HH:MM' or null for all-day)
// ---------------------------------------------------------------------------
app.get('/api/events', async (req, res) => {
  const { from, to } = req.query;
  if (from && to) {
    res.json(await db.all(
      'SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date, start_time', [from, to]));
  } else {
    res.json(await db.all('SELECT * FROM events ORDER BY date, start_time'));
  }
});

function eventFields(body) {
  const { title, date, member_id, start_time, end_time, notes } = body;
  if (!title || !String(title).trim()) return { error: 'Title is required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { error: 'Date must be YYYY-MM-DD' };
  const t = v => (v && /^\d{2}:\d{2}$/.test(v) ? v : null);
  return {
    values: [
      String(title).trim(),
      date,
      member_id ? Number(member_id) : null,
      t(start_time),
      t(end_time),
      notes ? String(notes).trim() : null
    ]
  };
}

app.post('/api/events', async (req, res) => {
  const f = eventFields(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  const r = await db.run(
    `INSERT INTO events (title, date, member_id, start_time, end_time, notes)
     VALUES (?, ?, ?, ?, ?, ?)`, f.values);
  res.status(201).json(await db.get('SELECT * FROM events WHERE id = ?', [r.lastID]));
});

app.put('/api/events/:id', async (req, res) => {
  const f = eventFields(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  await db.run(
    `UPDATE events SET title = ?, date = ?, member_id = ?, start_time = ?, end_time = ?, notes = ?
     WHERE id = ?`, [...f.values, Number(req.params.id)]);
  res.json(await db.get('SELECT * FROM events WHERE id = ?', [Number(req.params.id)]));
});

app.delete('/api/events/:id', async (req, res) => {
  await db.run('DELETE FROM events WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => console.log(`Family Schedule running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
