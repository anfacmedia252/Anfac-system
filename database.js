const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'anfac.db'));

// Initialize Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    budget REAL NOT NULL,
    spent REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    retainer REAL NOT NULL,
    status TEXT NOT NULL,
    campaigns INTEGER DEFAULT 1,
    logo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    client TEXT NOT NULL,
    category TEXT NOT NULL,
    deadline TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    client TEXT NOT NULL,
    datetime TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS equipment (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    serial_no TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    role TEXT NOT NULL,
    salary REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    photo TEXT
  );
`);

// Seed default records if table is empty
const row = db.prepare('SELECT COUNT(*) as count FROM transactions').get();
if (Number(row.count) === 0) {
  const insertTrans = db.prepare(`INSERT INTO transactions (id, date, type, title, category, method, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertTrans.run('TR-101', '2026-10-10', 'income', 'Banadir Retail Ads Retainer', 'Client Payment', 'Bank Transfer', 4500.00);
  insertTrans.run('TR-102', '2026-10-09', 'expense', 'Meta Ads Spend (Client #1)', 'Ad Spend', 'Credit Card', 1200.00);
  insertTrans.run('TR-103', '2026-10-08', 'expense', 'Video Editing Suite License', 'Software & Tools', 'Credit Card', 350.00);
  insertTrans.run('TR-104', '2026-10-07', 'income', 'Mogadishu Logistics PPC Campaign', 'Client Payment', 'EVC Plus / Mobile', 2800.00);

  const insertCamp = db.prepare(`INSERT INTO campaigns (id, name, client, budget, spent, status) VALUES (?, ?, ?, ?, ?, ?)`);
  insertCamp.run('CMP-1', 'Q4 Meta Growth Campaign', 'Banadir Retail Group', 5000, 3200, 'Active');
  insertCamp.run('CMP-2', 'Google PPC Search Ads', 'Mogadishu Logistics', 3000, 1800, 'Active');
  insertCamp.run('CMP-3', 'Commercial Video Production', 'Horn Energy Corp', 8500, 4000, 'In Production');

  const insertClient = db.prepare(`INSERT INTO clients (id, name, retainer, status, campaigns, logo) VALUES (?, ?, ?, ?, ?, ?)`);
  insertClient.run('CL-1', 'Banadir Retail Group', 4500, 'Paid', 2, 'https://placehold.co/100x100/0284c7/ffffff?text=BRG');
  insertClient.run('CL-2', 'Mogadishu Logistics', 2800, 'Paid', 1, 'https://placehold.co/100x100/e53e3e/ffffff?text=ML');
  insertClient.run('CL-3', 'Horn Energy Corp', 8500, 'Pending', 1, 'https://placehold.co/100x100/10b981/ffffff?text=HE');

  const insertProj = db.prepare(`INSERT INTO projects (id, title, client, category, deadline, status) VALUES (?, ?, ?, ?, ?, ?)`);
  insertProj.run('PRJ-1', 'Corporate Brand Video 4K', 'Horn Energy Corp', 'Video Production', '2026-11-15', 'In Progress');
  insertProj.run('PRJ-2', 'National TV Commercial', 'Banadir Retail Group', 'Media Buying', '2026-10-30', 'Planning');

  const insertBook = db.prepare(`INSERT INTO bookings (id, title, client, datetime, status) VALUES (?, ?, ?, ?, ?)`);
  insertBook.run('BK-1', 'Main Studio Podcast Recording', 'Mogadishu Logistics', '2026-10-18 10:00', 'Confirmed');

  const insertEq = db.prepare(`INSERT INTO equipment (id, name, category, serial_no, status) VALUES (?, ?, ?, ?, ?)`);
  insertEq.run('EQ-1', 'Sony FX6 Cinema Camera', 'Camera', 'SN-FX6-9901', 'Available');
  insertEq.run('EQ-2', 'Aputure 600d Pro Light', 'Lighting', 'SN-AP-4412', 'In Use');

  const insertStaff = db.prepare(`INSERT INTO staff (id, name, department, role, salary) VALUES (?, ?, ?, ?, ?)`);
  insertStaff.run('ST-1', 'Abdirahman Hassan', 'Administration', 'Head of Operations', 4200);
  insertStaff.run('ST-2', 'Farah Mohamed', 'Production', 'Cinematographer', 2500);

  const insertProfile = db.prepare(`INSERT INTO profile (id, first_name, last_name, email, role, photo) VALUES (1, ?, ?, ?, ?, ?)`);
  insertProfile.run('Eng Yusuf', 'Hassan', 'Engjoseph@anfacmedia.com', 'CEO & Founder', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80');
}

module.exports = db;