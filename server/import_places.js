// server/import_places.js
import fs from "fs";
import path from "path";
import sqlite3pkg from "sqlite3";
import { fileURLToPath } from "url";

const sqlite3 = sqlite3pkg.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPathArg = process.argv[2];
const truncate = process.argv.includes("--truncate");

if (!inputPathArg) {
  console.error("Usage: node server/import_places.js <path_to_json> [--truncate]");
  process.exit(1);
}

const inputPath = path.isAbsolute(inputPathArg)
  ? inputPathArg
  : path.resolve(process.cwd(), inputPathArg);

const dbPath = path.resolve(__dirname, "users.db");
const photosRoot = path.resolve(__dirname, "photos");
const PHOTO_BASE = "http://localhost:3001"; // чтобы картинки точно открывались с фронта

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function pickArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.places)) return data.places;
  return [];
}

function normalizeKey(s = "") {
  return s
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

function findFolderByName(placeName) {
  if (!placeName || !fs.existsSync(photosRoot)) return null;

  const dirs = fs.readdirSync(photosRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const target = normalizeKey(placeName);

  // 1) точное совпадение по нормализованному имени
  const exact = dirs.find((d) => normalizeKey(d) === target);
  if (exact) return exact;

  // 2) если не нашли — попробуем contains (мягкий матч)
  const soft = dirs.find((d) => normalizeKey(d).includes(target) || target.includes(normalizeKey(d)));
  return soft || null;
}

function listPhotos(folderName) {
  if (!folderName) return [];
  const folderPath = path.join(photosRoot, folderName);
  if (!fs.existsSync(folderPath)) return [];

  const files = fs.readdirSync(folderPath, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "ru"));

  return files.map((f) =>
    `${PHOTO_BASE}/photos/${encodeURIComponent(folderName)}/${encodeURIComponent(f)}`
  );
}

function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return [];
}

// ⚠️ тут “универсально” вытаскиваем поля из твоего JSON
function mapRecord(rec) {
  const name = rec.name || rec.title || rec.place || rec.coworking || "";
  const city = rec.city || rec.town || rec.location_city || "";
  const address = rec.address || rec.location || rec.full_address || "";
  const link = rec.link || rec.url || rec.source_url || null;

  const rating = rec.rating ?? rec.rate ?? null;
  const reviews = rec.reviews ?? rec.reviews_count ?? rec.reviewsCount ?? null;

  // тип — если в JSON нет, ставим “Коворкинг”
  const type = rec.type || rec.category || "Коворкинг";

  // фичи/удобства (если есть)
  const features = toArray(rec.features || rec.amenities || rec.tags);

  // badge — если есть, иначе пусто
  const badge = rec.badge || "";

  // фото: ищем папку по названию места
  const folder = findFolderByName(name);
  const photos = listPhotos(folder);
  const image = photos[0] || null; // ⭐ главное фото для карточки

  return {
    name,
    type,
    city,
    address,
    image,
    badge,
    rating,
    reviews,
    features: JSON.stringify(features),
    link,
  };
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    console.error("Файл не найден:", inputPath);
    process.exit(1);
  }
  if (!fs.existsSync(dbPath)) {
    console.error("База не найдена:", dbPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  const rows = pickArray(parsed);

  if (!rows.length) {
    console.error("В JSON не найден массив мест (ожидал массив или {items:[]}/{places:[]}).");
    process.exit(1);
  }

  const db = new sqlite3.Database(dbPath);

  try {
    const colsInfo = await dbAll(db, "PRAGMA table_info(places)");
    const columns = colsInfo.map((c) => c.name);

    if (truncate) {
      await dbRun(db, "DELETE FROM places");
      console.log("Очищено: places");
    }

    await dbRun(db, "BEGIN TRANSACTION");

    let inserted = 0;
    let withoutPhotos = 0;

    for (const rec of rows) {
      const p = mapRecord(rec);

      // берём только колонки, которые реально есть в places
      const insertCols = Object.keys(p).filter((k) => columns.includes(k));
      const values = insertCols.map((k) => p[k]);

      if (!p.image) withoutPhotos++;

      const placeholders = insertCols.map(() => "?").join(", ");
      const sql = `INSERT INTO places (${insertCols.join(", ")}) VALUES (${placeholders})`;

      await dbRun(db, sql, values);
      inserted++;
    }

    await dbRun(db, "COMMIT");
    console.log(`✅ Импорт: добавлено мест: ${inserted}`);
    console.log(`📸 Без найденных фото: ${withoutPhotos} (проверь совпадение названий папок)`);
  } catch (e) {
    try { await dbRun(db, "ROLLBACK"); } catch {}
    console.error("❌ Ошибка импорта:", e?.message || e);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
