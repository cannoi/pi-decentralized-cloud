const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database
const dbPath = path.join(__dirname, 'data', 'cloud.db');
const fs = require('fs');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initDb();
  }
});

function initDb() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS node_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      status TEXT,
      cpu_share INTEGER,
      ram_share INTEGER,
      storage_share INTEGER,
      bandwidth_share INTEGER,
      uptime INTEGER,
      credits_earned REAL,
      credits_spent REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT,
      receiver_id TEXT,
      amount REAL,
      type TEXT,
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS rentals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      renter_id TEXT,
      provider_id TEXT,
      resource_type TEXT,
      amount REAL,
      status TEXT,
      expires_at DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ledger_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prev_hash TEXT,
      hash TEXT,
      validator_id TEXT,
      transactions_count INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insert default node if empty
    db.get("SELECT COUNT(*) as count FROM node_status", (err, row) => {
      if (row.count === 0) {
        db.run(`INSERT INTO node_status (name, status, cpu_share, ram_share, storage_share, bandwidth_share, uptime, credits_earned, credits_spent) VALUES ('Pi-Node-Alpha', 'inactive', 0, 0, 0, 0, 0, 0.0, 0.0)`);
        db.run(`INSERT INTO ledger_blocks (prev_hash, hash, validator_id, transactions_count) VALUES ('0000000000000000', '0000000000000001', 'Genesis', 0)`);
      }
    });
  });
}

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// API Endpoints
app.get('/api/node', (req, res) => {
  db.get("SELECT * FROM node_status ORDER BY id DESC LIMIT 1", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

app.post('/api/node/toggle', (req, res) => {
  const { status, cpu_share, ram_share, storage_share, bandwidth_share } = req.body;
  db.get("SELECT * FROM node_status ORDER BY id DESC LIMIT 1", (err, node) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const newStatus = status !== undefined ? status : (node.status === 'active' ? 'inactive' : 'active');
    const cpu = cpu_share !== undefined ? cpu_share : node.cpu_share;
    const ram = ram_share !== undefined ? ram_share : node.ram_share;
    const storage = storage_share !== undefined ? storage_share : node.storage_share;
    const bw = bandwidth_share !== undefined ? bandwidth_share : node.bandwidth_share;
    
    db.run(
      `UPDATE node_status SET status = ?, cpu_share = ?, ram_share = ?, storage_share = ?, bandwidth_share = ?, uptime = uptime + 1 WHERE id = ?`,
      [newStatus, cpu, ram, storage, bw, node.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        // Award credits if active
        if (newStatus === 'active') {
          const earnedIncrement = (storage * 0.1) + (cpu * 0.05);
          db.run(`UPDATE node_status SET credits_earned = credits_earned + ? WHERE id = ?`, [earnedIncrement, node.id]);
          db.run(`INSERT INTO transactions (sender_id, receiver_id, amount, type, description) VALUES ('Network', ?, ?, 'REWARD', 'Resource contribution reward')`, [node.name, earnedIncrement]);
        }
        res.json({ success: true, status: newStatus, cpu_share: cpu, ram_share: ram, storage_share: storage, bandwidth_share: bw });
      }
    );
  });
});

app.get('/api/transactions', (req, res) => {
  db.all("SELECT * FROM transactions ORDER BY id DESC LIMIT 20", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/rentals', (req, res) => {
  db.all("SELECT * FROM rentals ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/rentals', (req, res) => {
  const { provider_id, resource_type, amount, cost } = req.body;
  db.get("SELECT * FROM node_status ORDER BY id DESC LIMIT 1", (err, node) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const availableCredits = (node.credits_earned || 0) - (node.credits_spent || 0);
    if (availableCredits < cost) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    db.run(`UPDATE node_status SET credits_spent = credits_spent + ? WHERE id = ?`, [cost, node.id]);
    db.run(
      `INSERT INTO rentals (renter_id, provider_id, resource_type, amount, status, expires_at) VALUES (?, ?, ?, ?, 'active', datetime('now', '+1 hour'))`,
      [node.name, provider_id, resource_type, amount],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`INSERT INTO transactions (sender_id, receiver_id, amount, type, description) VALUES (?, ?, ?, 'RENTAL', ?)`,
          [node.name, provider_id, cost, `Rent ${amount} ${resource_type} from ${provider_id}`]);
        res.json({ success: true, rental_id: this.lastID });
      }
    );
  });
});

app.get('/api/ledger', (req, res) => {
  db.all("SELECT * FROM ledger_blocks ORDER BY id DESC LIMIT 10", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pi Decentralized Cloud running on port ${PORT}`);
});
