// server/mergeKowoIntoBackup.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";

sqlite3.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Пути к БД и JSON ===
const dbPath = path.join(__dirname, "users-backup.db");
const kowoJsonPath = path.join(__dirname, "kowo_full.json");

console.log("Используем БД:", dbPath);
console.log("Читаем JSON:", kowoJsonPath);

if (!fs.existsSync(kowoJsonPath)) {
  console.error("Файл kowo_full.json не найден по пути:", kowoJsonPath);
  process.exit(1);
}

const raw = fs.readFileSync(kowoJsonPath, "utf8");
const jsonData = JSON.parse(raw);
const placesFromJson = Array.isArray(jsonData) ? jsonData : [jsonData];

// ===== Ключевые слова для FEATURES =====
const FEATURE_KEYWORDS = [
  { label: "расположение", patterns: ["располож", "расположение"] },
  { label: "комфортные условия", patterns: ["комфортные условия", "комфортн"] },
  { label: "Wi-Fi", patterns: ["wi-fi", "wifi", "вайфай"] },
  { label: "Кухня", patterns: ["кухн"] },
  { label: "Гибкие тарифы", patterns: ["гибкие тариф", "гибкий тариф"] },
  { label: "Дизайн", patterns: ["дизайн", "интерьер", "стильный интерьер"] },
  { label: "Тишина", patterns: ["тихо", "тишин"] },
  { label: "Кофе", patterns: ["кофе", "кофей"] },
];

function extractFeaturesAndDescription(pros, baseDescription) {
  const prosArray = Array.isArray(pros) ? pros.filter(Boolean) : [];
  const prosLower = prosArray.map((s) => String(s).toLowerCase());

  const usedIndexes = new Set();
  const matchedLabels = [];

  for (const { label, patterns } of FEATURE_KEYWORDS) {
    if (matchedLabels.length >= 3) break;

    let matched = false;
    prosLower.forEach((text, idx) => {
      if (matched) return;
      if (usedIndexes.has(idx)) return;

      const hasPattern = patterns.some((pat) => text.includes(pat));
      if (hasPattern) {
        matched = true;
        matchedLabels.push(label);

        prosLower.forEach((t2, idx2) => {
          if (patterns.some((pat) => t2.includes(pat))) {
            usedIndexes.add(idx2);
          }
        });
      }
    });
  }

  const leftoverPros = prosArray.filter((_, idx) => !usedIndexes.has(idx));

  let description = (baseDescription || "").trim();
  const leftoverText = leftoverPros.join("\n");

  if (leftoverText) {
    description = description ? `${description}\n\n${leftoverText}` : leftoverText;
  }

  if (!description) description = null;

  const featuresJson = matchedLabels.length ? JSON.stringify(matchedLabels) : null;
  return { featuresJson, description };
}

// ===== Определение типа места по JSON (segments / type) =====
function mapTypeFromJson(placeJson) {
  if (placeJson.type && String(placeJson.type).trim()) {
    return String(placeJson.type).trim();
  }

  const segments = [];
  if (Array.isArray(placeJson.segments)) segments.push(...placeJson.segments);
  if (placeJson.place && Array.isArray(placeJson.place.segments)) segments.push(...placeJson.place.segments);

  const segLower = segments.map((s) => String(s).toLowerCase());

  if (segLower.some((s) => s.includes("cafe") || s.includes("coffee") || s.includes("cafes"))) return "Кафе / кофейня";
  if (segLower.some((s) => s.includes("cowork"))) return "Коворкинг";
  if (segLower.some((s) => s.includes("library") || s.includes("библиот"))) return "Библиотека";
  if (segLower.some((s) => s.includes("office"))) return "Офис / рабочее пространство";
  if (segLower.some((s) => s.includes("restaurant") || s.includes("ресторан"))) return "Ресторан";
  if (segLower.some((s) => s.includes("bar"))) return "Бар";

  return "Коворкинг / антикафе";
}

// ===== ЧИСТКА ЧАСОВ РАБОТЫ =====
function extractWorkingHours(rawHours) {
  if (!rawHours) return null;

  const text = String(rawHours)
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();

  if (!text) return null;

  // режем по строкам, выкидываем пустые
  let lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  // убираем “мусорные” куски (wi-fi, бесплатно и т.п.)
  const trashRe = /(wi-?fi|wifi|вайфай|бесплатно|free|оплата|цены|кофе)/i;
  lines = lines
    .map((l) => l.replace(trashRe, "").trim())
    .filter(Boolean);

  // оставляем только строки, где есть день недели/ежедневно/или время
  const dayRe = /(ежедневно|круглосуточно|будни|выходн|пн|вт|ср|чт|пт|сб|вс|понедельник|воскресенье)/i;
  const timeRe = /\b\d{1,2}:\d{2}\b/;

  const good = lines.filter((l) => dayRe.test(l) || timeRe.test(l));

  // если фильтрация всё съела — вернём первые 1–2 строки как fallback
  const finalLines = good.length ? good : lines.slice(0, 2);

  return finalLines.join("\n").trim() || null;
}

// ===== Телефон =====
function extractPhone(placeJson) {
  const placeBlock = placeJson.place || {};
  const rawPhone =
    (placeBlock.phone && String(placeBlock.phone).trim()) ||
    (placeJson.phone && String(placeJson.phone).trim()) ||
    null;

  return rawPhone && rawPhone.trim() ? rawPhone.trim() : null;
}

// ===== Галерея картинок =====
// Предпочтение: photos_files (локальные), иначе photo_urls (удалённые)
function extractImages(placeJson) {
  const files = Array.isArray(placeJson.photos_files) ? placeJson.photos_files : [];
  const urls = Array.isArray(placeJson.photo_urls) ? placeJson.photo_urls : [];

  // Преобразуем windows-path "photos\Папка\01.png" -> "/photos/Папка/01.png"
  // ВАЖНО: это будет отдавать API (3001), а фронт мы научим подставлять API_BASE.
  const normalizedFiles = files
    .map((p) => String(p).trim())
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, "/"))
    .map((p) => {
      const idx = p.toLowerCase().indexOf("photos/");
      if (idx >= 0) return "/" + p.slice(idx); // "/photos/...."
      return p.startsWith("/") ? p : "/" + p;
    });

  const list = normalizedFiles.length ? normalizedFiles : urls;
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1) Таблица places (с нужными полями)
  db.run(
    `
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      city TEXT,
      address TEXT,
      image TEXT,
      images TEXT,      -- JSON-массив
      badge TEXT,
      rating REAL,
      reviews INTEGER,
      features TEXT,    -- JSON-массив
      link TEXT,
      description TEXT,
      hours TEXT,
      phone TEXT
    )
  `,
    (err) => {
      if (err) console.error("Ошибка CREATE TABLE places:", err);
    }
  );

  // 2) Добавляем колонки на старых БД (если нет)
  db.all("PRAGMA table_info(places)", (err, cols) => {
    if (err) {
      console.error("Ошибка PRAGMA table_info:", err);
      processPlaces();
      return;
    }

    const need = [
      "images",
      "description",
      "hours",
      "phone",
    ].filter((col) => !cols.some((c) => c.name === col));

    if (!need.length) {
      processPlaces();
      return;
    }

    let pending = need.length;
    const done = () => {
      pending--;
      if (pending === 0) processPlaces();
    };

    need.forEach((col) => {
      db.run(`ALTER TABLE places ADD COLUMN ${col} TEXT`, (e) => {
        if (e) console.error(`Ошибка ALTER TABLE (${col}):`, e);
        else console.log(`Колонка ${col} добавлена в places`);
        done();
      });
    });
  });
});

function processPlaces() {
  db.all(
    "SELECT id, name, type, city, address, image, images, badge, rating, reviews, features, link, description, hours, phone FROM places",
    (err, rows) => {
      if (err) {
        console.error("Ошибка SELECT из places:", err);
        db.close();
        return;
      }

      const byName = new Map();
      for (const row of rows) {
        const key = (row.name || "").trim();
        if (key && !byName.has(key)) byName.set(key, row);
      }

      const updateStmt = db.prepare(`
        UPDATE places
        SET
          type = ?,
          city = ?,
          address = ?,
          badge = ?,
          rating = ?,
          reviews = ?,
          features = ?,
          link = ?,
          description = ?,
          hours = ?,
          phone = ?,
          images = ?
        WHERE id = ?
      `);

      const insertStmt = db.prepare(`
        INSERT INTO places
          (name, type, city, address, image, images, badge, rating, reviews, features, link, description, hours, phone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let processed = 0;
      let updated = 0;
      let inserted = 0;

      for (const p of placesFromJson) {
        const name = (p.name || "").trim();
        if (!name) continue;
        processed++;

        const placeBlock = p.place || {};

        // address
        let parsedAddress = placeBlock.address || p.address || null;

        const metroText =
          (typeof placeBlock.metro === "string" && placeBlock.metro) ||
          (typeof p.metro === "string" && p.metro) ||
          "";

        if (!parsedAddress && metroText) {
          const addrIndex = metroText.indexOf("Адрес:");
          if (addrIndex >= 0) {
            let a = metroText.slice(addrIndex + "Адрес:".length);
            const hoursIdx = a.indexOf("Часы работы");
            if (hoursIdx >= 0) a = a.slice(0, hoursIdx);
            parsedAddress = a.trim() || null;
          }
        }

        // rating/reviews
        const newRating = typeof p.rating === "number" ? p.rating : null;
        const newReviews =
          typeof p.reviews === "number"
            ? p.reviews
            : typeof p.reviews_count === "number"
            ? p.reviews_count
            : null;

        // features/description
        const { featuresJson, description } = extractFeaturesAndDescription(p.pros, p.description);

        // link
        const newLink = placeBlock.map_url || p.map_url || p.url || null;

        // hours (clean)
        const hoursRaw = (placeBlock.hours && String(placeBlock.hours).trim()) || (p.hours && String(p.hours).trim()) || null;
        const hoursClean = extractWorkingHours(hoursRaw);

        // phone
        const phone = extractPhone(p);

        // type/city defaults
        const typeFromJson = mapTypeFromJson(p);
        const typeToSetDefault = typeFromJson || "Коворкинг / антикафе";
        const cityDefault = "Москва";

        // images
        const images = extractImages(p);
        const imagesJson = JSON.stringify(images);

        const existing = byName.get(name);

        if (existing) {
          const typeToSet = typeFromJson || existing.type || "Коворкинг / антикафе";
          const cityToSet = existing.city || cityDefault;
          const addressToSet = parsedAddress || existing.address || null;
          const badgeToSet = existing.badge || null;

          const ratingToSet = newRating !== null ? newRating : existing.rating;
          const reviewsToSet = newReviews !== null ? newReviews : existing.reviews;

          const featuresToSet = featuresJson !== null ? featuresJson : existing.features;
          const linkToSet = newLink || existing.link || null;

          const descriptionToSet = description || existing.description || null;
          const hoursToSet = hoursClean || existing.hours || null;
          const phoneToSet = phone || existing.phone || null;

          // images: если в БД пусто — заполним из JSON
          const imagesToSet = (existing.images && String(existing.images).trim()) ? existing.images : imagesJson;

          updateStmt.run(
            typeToSet,
            cityToSet,
            addressToSet,
            badgeToSet,
            ratingToSet,
            reviewsToSet,
            featuresToSet,
            linkToSet,
            descriptionToSet,
            hoursToSet,
            phoneToSet,
            imagesToSet,
            existing.id,
            (uErr) => {
              if (uErr) console.error(`❌ Ошибка UPDATE для "${name}":`, uErr);
              else updated++;
            }
          );
        } else {
          // cover image: первая из images (если есть)
          const imageFromJson = images[0] || (Array.isArray(p.photo_urls) && p.photo_urls[0]) || null;

          insertStmt.run(
            name,                 // name
            typeToSetDefault,     // type
            cityDefault,          // city
            parsedAddress,        // address
            imageFromJson,        // image
            imagesJson,           // images
            null,                 // badge
            newRating,            // rating
            newReviews,           // reviews
            featuresJson,         // features
            newLink,              // link
            description,          // description
            hoursClean,           // hours
            phone,                // phone
            (iErr) => {
              if (iErr) console.error(`❌ Ошибка INSERT для "${name}":`, iErr);
              else inserted++;
            }
          );
        }
      }

      updateStmt.finalize((e1) => {
        if (e1) console.error("Ошибка finalize UPDATE:", e1);
        insertStmt.finalize((e2) => {
          if (e2) console.error("Ошибка finalize INSERT:", e2);

          console.log(`Обработано объектов из JSON: ${processed}`);
          console.log(`Обновлено записей в БД: ${updated}`);
          console.log(`Добавлено новых мест: ${inserted}`);
          db.close();
        });
      });
    }
  );
}