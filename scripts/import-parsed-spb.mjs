import fs from "node:fs/promises";
import path from "node:path";
import sqlite3pkg from "sqlite3";
import { fileURLToPath } from "node:url";

const sqlite3 = sqlite3pkg.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.resolve(__dirname, "../server/parsed/kovorkingi-spb.json");
const dbPath = path.resolve(__dirname, "../server/users.db");

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function main() {
  const raw = await fs.readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  const places = Array.isArray(parsed?.places) ? parsed.places : [];

  if (!places.length) {
    throw new Error(`No places found in ${inputPath}`);
  }

  const db = new sqlite3.Database(dbPath);

  try {
    await dbRun(db, "BEGIN TRANSACTION");

    let inserted = 0;
    let updated = 0;

    for (const place of places) {
      const name = normalizeString(place.name);
      const city = normalizeString(place.city);
      const address = normalizeString(place.address);

      if (!name || !city || !address) continue;

      const image = normalizeString(place.image) || null;
      const imagesJson = JSON.stringify(Array.isArray(place.images) ? place.images.filter(Boolean) : []);
      const featuresJson = JSON.stringify(Array.isArray(place.features) ? place.features.filter(Boolean) : []);
      const type = normalizeString(place.type) || "Коворкинг";
      const link = normalizeString(place.link || place.sourceUrl) || null;
      const description = normalizeString(place.description) || null;
      const hours = normalizeString(place.hours) || null;
      const phone = normalizeString(place.phone) || null;
      const badge = normalizeString(place.badge) || null;
      const rating = typeof place.rating === "number" ? place.rating : null;
      const reviews = Number.isInteger(place.reviews) ? place.reviews : null;

      const existing = await dbGet(
        db,
        "SELECT id FROM places WHERE name = ? AND city = ? LIMIT 1",
        [name, city]
      );

      if (existing?.id) {
        await dbRun(
          db,
          `UPDATE places
           SET type = ?, address = ?, image = ?, images = ?, badge = ?, rating = ?, reviews = ?, features = ?, link = ?, description = ?, hours = ?, phone = ?, moderation_status = 'approved'
           WHERE id = ?`,
          [
            type,
            address,
            image,
            imagesJson,
            badge,
            rating,
            reviews,
            featuresJson,
            link,
            description,
            hours,
            phone,
            existing.id,
          ]
        );
        updated += 1;
        continue;
      }

      await dbRun(
        db,
        `INSERT INTO places
          (name, type, city, address, image, images, badge, rating, reviews, features, link, description, hours, phone, moderation_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
        [
          name,
          type,
          city,
          address,
          image,
          imagesJson,
          badge,
          rating,
          reviews,
          featuresJson,
          link,
          description,
          hours,
          phone,
        ]
      );
      inserted += 1;
    }

    await dbRun(db, "COMMIT");

    const spbCount = await dbGet(
      db,
      "SELECT COUNT(*) AS cnt FROM places WHERE city = ?",
      ["Санкт-Петербург"]
    );

    console.log(JSON.stringify({ inserted, updated, spbCount: spbCount?.cnt ?? 0 }, null, 2));
  } catch (error) {
    try {
      await dbRun(db, "ROLLBACK");
    } catch {}
    throw error;
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
