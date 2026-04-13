// server/db.js
import fs from "fs";
import sqlite3pkg from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const sqlite3 = sqlite3pkg.verbose();

// Аналог __dirname для ES-модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envDbPath = process.env.DB_PATH;
const dbPath = envDbPath
  ? path.resolve(process.cwd(), envDbPath)
  : path.resolve(__dirname, "users.db");
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      city TEXT,
      email TEXT,
      status TEXT
    )
  `);

  // Тестовый пользователь: admin / 12345
  db.run(
    `INSERT OR IGNORE INTO users 
      (login, password, first_name, last_name, city, email, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["admin", "12345", "Admin", "User", "", "", "админ"]
  );
});

export default db;
