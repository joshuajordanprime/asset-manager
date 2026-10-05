const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const STATUSES = ['In Use', 'In Storage', 'In Repair', 'Retired'];
const CATEGORIES = ['Laptop', 'Desktop', 'Phone', 'Monitor', 'Network', 'Software License', 'Other'];

const db = new Database(process.env.DB_FILE || 'assets.db');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  serial TEXT,
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'In Storage',
  purchase_date TEXT,
  warranty_expiry TEXT,
  cost REAL DEFAULT 0,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS asset_history (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  change TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id, status);
`);

const app = express();
app.use(express.json());
app.use(express.static('public'));

const sign = (id) => jwt.sign({ id }, SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  try { req.userId = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Please log in again.' }); }
}

const dateOk = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
function validate(b) {
  if (!b.name?.trim()) return 'Name is required.';
  if (!CATEGORIES.includes(b.category)) return 'Invalid category.';
  if (!STATUSES.includes(b.status)) return 'Invalid status.';
  if (!dateOk(b.purchase_date) || !dateOk(b.warranty_expiry)) return 'Dates must be valid.';
  if (b.cost !== undefined && b.cost !== '' && (isNaN(b.cost) || b.cost < 0)) return 'Cost must be a positive number.';
  return null;
}
const clean = (b) => [b.name.trim(), b.category, b.serial?.trim() || null, b.assigned_to?.trim() || null, b.status,
  b.purchase_date || null, b.warranty_expiry || null, Number(b.cost) || 0, b.notes || ''];
const mine = (req) => db.prepare('SELECT * FROM assets WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);

app.post('/api/signup', (req, res) => {
  const { email, password } = req.body;
  if (!email?.includes('@') || (password || '').length < 8)
    return res.status(400).json({ error: 'Use a valid email and a password of 8+ characters.' });
  try {
    const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email.toLowerCase(), bcrypt.hashSync(password, 10));
    res.json({ token: sign(info.lastInsertRowid) });
  } catch { res.status(409).json({ error: 'That email already has an account.' }); }
});

app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash))
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: sign(u.id) });
});

app.get('/api/assets', auth, (req, res) => {
  const where = ['user_id = ?'], args = [req.userId];
  if (STATUSES.includes(req.query.status)) { where.push('status = ?'); args.push(req.query.status); }
  if (CATEGORIES.includes(req.query.category)) { where.push('category = ?'); args.push(req.query.category); }
  if (req.query.q) {
    where.push('(name LIKE ? OR serial LIKE ? OR assigned_to LIKE ?)');
    const q = `%${req.query.q}%`; args.push(q, q, q);
  }
  res.json(db.prepare(`SELECT * FROM assets WHERE ${where.join(' AND ')} ORDER BY name`).all(...args));
});

app.post('/api/assets', auth, (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const info = db.prepare(`INSERT INTO assets (user_id, name, category, serial, assigned_to, status, purchase_date, warranty_expiry, cost, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.userId, ...clean(req.body));
  db.prepare('INSERT INTO asset_history (asset_id, change) VALUES (?, ?)').run(info.lastInsertRowid,
    `Added as ${req.body.status}${req.body.assigned_to?.trim() ? ', assigned to ' + req.body.assigned_to.trim() : ''}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/assets/:id', auth, (req, res) => {
  const old = mine(req);
  if (!old) return res.status(404).json({ error: 'Asset not found.' });
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const v = clean(req.body);
  db.prepare(`UPDATE assets SET name=?, category=?, serial=?, assigned_to=?, status=?, purchase_date=?, warranty_expiry=?, cost=?, notes=? WHERE id=?`)
    .run(...v, old.id);
  const log = db.prepare('INSERT INTO asset_history (asset_id, change) VALUES (?, ?)');
  if ((old.assigned_to || null) !== v[3]) log.run(old.id, `Assigned: ${old.assigned_to || 'nobody'} to ${v[3] || 'nobody'}`);
  if (old.status !== v[4]) log.run(old.id, `Status: ${old.status} to ${v[4]}`);
  res.json({ ok: true });
});

app.delete('/api/assets/:id', auth, (req, res) => {
  const info = db.prepare('DELETE FROM assets WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  info.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Asset not found.' });
});

app.get('/api/assets/:id/history', auth, (req, res) => {
  if (!mine(req)) return res.status(404).json({ error: 'Asset not found.' });
  res.json(db.prepare('SELECT change, created_at FROM asset_history WHERE asset_id = ? ORDER BY id DESC').all(req.params.id));
});

app.get('/api/stats', auth, (req, res) => {
  const group = (col, list) => {
    const out = Object.fromEntries(list.map((k) => [k, 0]));
    db.prepare(`SELECT ${col} k, COUNT(*) c FROM assets WHERE user_id = ? GROUP BY ${col}`).all(req.userId).forEach((r) => (out[r.k] = r.c));
    return out;
  };
  const live = "user_id = ? AND status != 'Retired' AND warranty_expiry IS NOT NULL";
  const expiring = db.prepare(`SELECT id, name, warranty_expiry FROM assets WHERE ${live} AND warranty_expiry BETWEEN date('now') AND date('now', '+60 days') ORDER BY warranty_expiry`).all(req.userId);
  const expired = db.prepare(`SELECT COUNT(*) c FROM assets WHERE ${live} AND warranty_expiry < date('now')`).get(req.userId).c;
  const total = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(cost),0) v FROM assets WHERE user_id = ? AND status != 'Retired'").get(req.userId);
  res.json({ byStatus: group('status', STATUSES), byCategory: group('category', CATEGORIES), expiring, expired, activeCount: total.n, activeValue: total.v });
});

app.get('/api/export.csv', auth, (req, res) => {
  const rows = db.prepare('SELECT name, category, serial, assigned_to, status, purchase_date, warranty_expiry, cost, notes FROM assets WHERE user_id = ? ORDER BY name').all(req.userId);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.type('text/csv').send(['Name,Category,Serial,Assigned to,Status,Purchased,Warranty expires,Cost,Notes', ...rows.map((r) => Object.values(r).map(esc).join(','))].join('\n'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Asset manager running at http://localhost:${port}`));
