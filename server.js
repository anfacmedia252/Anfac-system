const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Transactions
app.get('/api/transactions', (req, res) => {
  res.json(db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all());
});

app.post('/api/transactions', (req, res) => {
  const { id, date, type, title, category, method, amount } = req.body;
  const newId = id || 'TR-' + Math.floor(100 + Math.random() * 900);
  const transDate = date || new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO transactions (id, date, type, title, category, method, amount)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId, transDate, type, title, category, method, parseFloat(amount));
  res.status(201).json({ success: true, id: newId });
});

app.put('/api/transactions/:id', (req, res) => {
  const { type, title, category, method, amount } = req.body;
  db.prepare(`
    UPDATE transactions SET type = ?, title = ?, category = ?, method = ?, amount = ?
    WHERE id = ?
  `).run(type, title, category, method, parseFloat(amount), req.params.id);
  res.json({ success: true });
});

app.delete('/api/transactions/:id', (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Campaigns
app.get('/api/campaigns', (req, res) => {
  res.json(db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all());
});

app.post('/api/campaigns', (req, res) => {
  const { name, client, budget, spent, status } = req.body;
  const id = 'CMP-' + Math.floor(100 + Math.random() * 900);
  db.prepare(`
    INSERT INTO campaigns (id, name, client, budget, spent, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, client, parseFloat(budget), parseFloat(spent || 0), status || 'Active');
  res.status(201).json({ success: true, id });
});

app.put('/api/campaigns/:id', (req, res) => {
  const { name, client, budget, spent, status } = req.body;
  db.prepare(`
    UPDATE campaigns SET name = ?, client = ?, budget = ?, spent = ?, status = ?
    WHERE id = ?
  `).run(name, client, parseFloat(budget), parseFloat(spent || 0), status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/campaigns/:id', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Clients
app.get('/api/clients', (req, res) => {
  res.json(db.prepare('SELECT * FROM clients ORDER BY id DESC').all());
});

app.post('/api/clients', (req, res) => {
  const { name, retainer, status, logo } = req.body;
  const id = 'CL-' + Math.floor(100 + Math.random() * 900);
  db.prepare(`
    INSERT INTO clients (id, name, retainer, status, campaigns, logo)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, name, parseFloat(retainer), status, logo || '');
  res.status(201).json({ success: true, id });
});

app.put('/api/clients/:id', (req, res) => {
  const { name, retainer, status, logo } = req.body;
  db.prepare(`
    UPDATE clients SET name = ?, retainer = ?, status = ?, logo = ?
    WHERE id = ?
  `).run(name, parseFloat(retainer), status, logo || '', req.params.id);
  res.json({ success: true });
});

app.delete('/api/clients/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Projects
app.get('/api/projects', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY id DESC').all());
});

app.post('/api/projects', (req, res) => {
  const { title, client, category, deadline, status } = req.body;
  const id = 'PRJ-' + Math.floor(100 + Math.random() * 900);
  db.prepare(`
    INSERT INTO projects (id, title, client, category, deadline, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, title, client, category, deadline, status);
  res.status(201).json({ success: true, id });
});

app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Bookings
app.get('/api/bookings', (req, res) => {
  res.json(db.prepare('SELECT * FROM bookings ORDER BY datetime ASC').all());
});

app.post('/api/bookings', (req, res) => {
  const { title, client, datetime, status } = req.body;
  const id = 'BK-' + Math.floor(100 + Math.random() * 900);
  db.prepare(`
    INSERT INTO bookings (id, title, client, datetime, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, title, client, datetime, status || 'Confirmed');
  res.status(201).json({ success: true, id });
});

app.delete('/api/bookings/:id', (req, res) => {
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Equipment
app.get('/api/equipment', (req, res) => {
  res.json(db.prepare('SELECT * FROM equipment ORDER BY id DESC').all());
});

app.post('/api/equipment', (req, res) => {
  const { name, category, serial_no, status } = req.body;
  const id = 'EQ-' + Math.floor(100 + Math.random() * 900);
  db.prepare(`
    INSERT INTO equipment (id, name, category, serial_no, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, category, serial_no, status || 'Available');
  res.status(201).json({ success: true, id });
});

app.delete('/api/equipment/:id', (req, res) => {
  db.prepare('DELETE FROM equipment WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Staff
app.get('/api/staff', (req, res) => {
  res.json(db.prepare('SELECT * FROM staff ORDER BY id DESC').all());
});

app.post('/api/staff', (req, res) => {
  const { name, department, role, salary } = req.body;
  const id = 'ST-' + Math.floor(100 + Math.random() * 900);
  db.prepare(`
    INSERT INTO staff (id, name, department, role, salary)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, department, role, parseFloat(salary));
  res.status(201).json({ success: true, id });
});

app.delete('/api/staff/:id', (req, res) => {
  db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Profile
app.get('/api/profile', (req, res) => {
  res.json(db.prepare('SELECT * FROM profile WHERE id = 1').get());
});

app.put('/api/profile', (req, res) => {
  const { first_name, last_name, email, role, photo } = req.body;
  db.prepare(`
    UPDATE profile
    SET first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        email = COALESCE(?, email),
        role = COALESCE(?, role),
        photo = COALESCE(?, photo)
    WHERE id = 1
  `).run(first_name, last_name, email, role, photo);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`ANFAC MEDIA SYSTEM - RUNNING ON LOCALHOST`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`Database: SQLite (anfac.db in sync)`);
  console.log(`===============================================`);
});