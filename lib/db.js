'use strict';

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'tickets.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('super_admin','agent')),
    name          TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_uid           TEXT NOT NULL UNIQUE,
    product              TEXT NOT NULL DEFAULT 'ClockEarnings',
    subject              TEXT NOT NULL,
    summary              TEXT,
    priority             TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('urgent','normal','low')),
    status               TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting','closed')),
    user_name            TEXT,
    user_email           TEXT,
    assigned_to          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    source_created_label TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_status  ON tickets(status);
  CREATE INDEX IF NOT EXISTS idx_tickets_product ON tickets(product);

  CREATE TABLE IF NOT EXISTS ticket_notes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id      INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note_type      TEXT NOT NULL DEFAULT 'note' CHECK(note_type IN ('note','status_change','assignment_change')),
    body           TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_ticket_id ON ticket_notes(ticket_id);
`);

// ── Bootstrap the first super_admin ─────────────────────────────────────────────
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    db.prepare(`
      INSERT INTO users (email, password_hash, role, name, created_at)
      VALUES (?, ?, 'super_admin', ?, ?)
    `).run(
      process.env.ADMIN_EMAIL.toLowerCase().trim(),
      bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12),
      'Admin',
      new Date().toISOString()
    );
    console.log(`  Bootstrapped super_admin account: ${process.env.ADMIN_EMAIL}`);
  } else {
    console.log('  ⚠️  No users exist and ADMIN_EMAIL/ADMIN_PASSWORD are not set — nobody can log in until they are.');
  }
}

module.exports = db;
