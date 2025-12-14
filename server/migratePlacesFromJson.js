// server/migratePlacesFromJson.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// путь до фронтового places.json
const placesJsonPath = path.resolve(__dirname, "../src/places.json");

console.log("Читаем JSON:", placesJsonPath);

const raw = fs.readFileSync(placesJsonPath, "utf8");
const places = JSON.parse(raw);

// создаём таблицу на всякий случай
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      city TEXT,
      address TEXT,
      image TEXT,
      badge TEXT,
      rating REAL,
      reviews INTEGER,
      features TEXT,
      link TEXT
    )
  `);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO places
      (id, name, type, city, address, image, badge, rating, reviews, features, link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of places) {
    stmt.run(
      p.id,
      p.name,
      p.type || null,
      p.city || null,
      p.address || null,
      p.image || null,
      p.badge || null,
      typeof p.rating === "number" ? p.rating : null,
      typeof p.reviews === "number" ? p.reviews : null,
      p.features ? JSON.stringify(p.features) : "[]",
      p.link || null
    );
  }

  stmt.finalize((err) => {
    if (err) {
      console.error("Ошибка при миграции:", err);
    } else {
      console.log("Миграция завершена успешно");
    }
    db.close();
  });
});