import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DATABASE_PATH || './data/calendar-reminder.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db: DatabaseType = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expiry INTEGER,
    discord_webhook_url TEXT,
    reminder_minutes INTEGER DEFAULT 10,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS notified (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    event_start INTEGER NOT NULL,
    notified_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, event_id, event_start)
  );

  CREATE INDEX IF NOT EXISTS idx_notified_user_event ON notified(user_id, event_id);
`);

export interface User {
  id: number;
  google_id: string;
  email: string;
  access_token: string;
  refresh_token: string | null;
  token_expiry: number | null;
  discord_webhook_url: string | null;
  reminder_minutes: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface Notified {
  id: number;
  user_id: number;
  event_id: string;
  event_start: number;
  notified_at: number;
}

export const queries = {
  upsertUser: db.prepare(`
    INSERT INTO users (google_id, email, access_token, refresh_token, token_expiry)
    VALUES (@google_id, @email, @access_token, @refresh_token, @token_expiry)
    ON CONFLICT(google_id) DO UPDATE SET
      email = @email,
      access_token = @access_token,
      refresh_token = COALESCE(@refresh_token, users.refresh_token),
      token_expiry = @token_expiry,
      updated_at = unixepoch()
  `),

  getUserByGoogleId: db.prepare<string>(`
    SELECT * FROM users WHERE google_id = ?
  `),

  getUserById: db.prepare<number>(`
    SELECT * FROM users WHERE id = ?
  `),

  getAllEnabledUsers: db.prepare(`
    SELECT * FROM users WHERE enabled = 1 AND discord_webhook_url IS NOT NULL
  `),

  updateUserSettings: db.prepare(`
    UPDATE users SET
      discord_webhook_url = @discord_webhook_url,
      reminder_minutes = @reminder_minutes,
      enabled = @enabled,
      updated_at = unixepoch()
    WHERE id = @id
  `),

  updateUserTokens: db.prepare(`
    UPDATE users SET
      access_token = @access_token,
      refresh_token = COALESCE(@refresh_token, refresh_token),
      token_expiry = @token_expiry,
      updated_at = unixepoch()
    WHERE id = @id
  `),

  isNotified: db.prepare<[number, string, number]>(`
    SELECT 1 FROM notified WHERE user_id = ? AND event_id = ? AND event_start = ?
  `),

  insertNotified: db.prepare(`
    INSERT OR IGNORE INTO notified (user_id, event_id, event_start)
    VALUES (@user_id, @event_id, @event_start)
  `),

  cleanOldNotifications: db.prepare(`
    DELETE FROM notified WHERE event_start < unixepoch() - 86400
  `),
};

export default db;
