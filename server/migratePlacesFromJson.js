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
  const prosLower = prosArray.map((s) => s.toLowerCase());

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

        // помечаем все строки, где есть этот паттерн, как "использованные"
        prosLower.forEach((t2, idx2) => {
          if (patterns.some((pat) => t2.includes(pat))) {
            usedIndexes.add(idx2);
          }
        });
      }
    });
  }

  // Остаток плюсов — в описание
  const leftoverPros = prosArray.filter((_, idx) => !usedIndexes.has(idx));

  let description = (baseDescription || "").trim();
  const leftoverText = leftoverPros.join("\n");

  if (leftoverText) {
    description = description
      ? `${description}\n\n${leftoverText}`
      : leftoverText;
  }

  if (!description) description = null;

  const featuresJson = matchedLabels.length
    ? JSON.stringify(matchedLabels)
    : null;

  return { featuresJson, description };
}

// ===== Определение типа места по JSON (segments / type) =====
function mapTypeFromJson(placeJson) {
  // если в JSON уже есть понятный type — используем его
  if (placeJson.type && String(placeJson.type).trim()) {
    return String(placeJson.type).trim();
  }

  const segments = [];
  if (Array.isArray(placeJson.segments)) {
    segments.push(...placeJson.segments);
  }
  if (placeJson.place && Array.isArray(placeJson.place.segments)) {
    segments.push(...placeJson.place.segments);
  }

  const segLower = segments.map((s) => String(s).toLowerCase());

  if (segLower.some((s) => s.includes("cafe") || s.includes("coffee") || s.includes("cafes"))) {
    return "Кафе / кофейня";
  }
  if (segLower.some((s) => s.includes("cowork"))) {
    return "Коворкинг";
  }
  if (segLower.some((s) => s.includes("library") || s.includes("библиот"))) {
    return "Библиотека";
  }
  if (segLower.some((s) => s.includes("office"))) {
    return "Офис / рабочее пространство";
  }
  if (segLower.some((s) => s.includes("restaurant") || s.includes("ресторан"))) {
    return "Ресторан";
  }
  if (segLower.some((s) => s.includes("bar"))) {
    return "Бар";
  }

  // дефолт — как раньше
  return "Коворкинг / антикафе";
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1) На случай, если таблицы вообще не было
  db.run(
    `
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
  `,
    (err) => {
      if (err) {
        console.error("Ошибка CREATE TABLE places:", err);
      }
    }
  );

  // 2) Проверяем наличие колонок description и hours, при отсутствии — добавляем
  db.all("PRAGMA table_info(places)", (err, cols) => {
    if (err) {
      console.error("Ошибка PRAGMA table_info:", err);
      processPlaces();
      return;
    }

    const hasDescription = cols.some((c) => c.name === "description");
    const hasHours = cols.some((c) => c.name === "hours");

    let pendingAlters = 0;

    if (!hasDescription) pendingAlters++;
    if (!hasHours) pendingAlters++;

    if (pendingAlters === 0) {
      processPlaces();
      return;
    }

    const doneAlter = () => {
      pendingAlters--;
      if (pendingAlters === 0) {
        processPlaces();
      }
    };

    if (!hasDescription) {
      db.run(
        "ALTER TABLE places ADD COLUMN description TEXT",
        (alterErr) => {
          if (alterErr) {
            console.error("Ошибка ALTER TABLE (description):", alterErr);
          } else {
            console.log("Колонка description добавлена в таблицу places");
          }
          doneAlter();
        }
      );
    }

    if (!hasHours) {
      db.run(
        "ALTER TABLE places ADD COLUMN hours TEXT",
        (alterErr) => {
          if (alterErr) {
            console.error("Ошибка ALTER TABLE (hours):", alterErr);
          } else {
            console.log("Колонка hours добавлена в таблицу places");
          }
          doneAlter();
        }
      );
    }
  });
});

function processPlaces() {
  // 3) Считываем текущее содержимое таблицы (с description и hours)
  db.all(
    "SELECT id, name, type, city, address, image, badge, rating, reviews, features, link, description, hours FROM places",
    (err, rows) => {
      if (err) {
        console.error("Ошибка SELECT из places:", err);
        db.close();
        return;
      }

      const byName = new Map();
      for (const row of rows) {
        const key = (row.name || "").trim();
        if (!key) continue;
        if (!byName.has(key)) {
          byName.set(key, row);
        }
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
          hours = ?
        WHERE id = ?
      `);

      const insertStmt = db.prepare(`
        INSERT INTO places
          (name, type, city, address, image, badge, rating, reviews, features, link, description, hours)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let processed = 0;
      let updated = 0;
      let inserted = 0;

      for (const p of placesFromJson) {
        const name = (p.name || "").trim();
        if (!name) continue;
        processed++;

        // --- блок place (старый формат) и верхний уровень (новый формат) ---
        const placeBlock = p.place || {};

        // адрес: сначала берём явный address (place.address или p.address),
        // если нет — пытаемся вытащить из строки metro
        let parsedAddress =
          placeBlock.address ||
          p.address ||
          null;

        const metroText =
          (typeof placeBlock.metro === "string" && placeBlock.metro) ||
          (typeof p.metro === "string" && p.metro) ||
          "";

        if (!parsedAddress && metroText) {
          const addrIndex = metroText.indexOf("Адрес:");
          if (addrIndex >= 0) {
            let a = metroText.slice(addrIndex + "Адрес:".length);
            const hoursIdx = a.indexOf("Часы работы");
            if (hoursIdx >= 0) {
              a = a.slice(0, hoursIdx);
            }
            parsedAddress = a.trim() || null;
          }
        }

        // рейтинг и отзывы — поддерживаем и reviews, и reviews_count
        const newRating =
          typeof p.rating === "number" ? p.rating : null;

        const newReviews =
          typeof p.reviews === "number"
            ? p.reviews
            : typeof p.reviews_count === "number"
            ? p.reviews_count
            : null;

        // фичи и описание из pros / description
        const { featuresJson, description } = extractFeaturesAndDescription(
          p.pros,
          p.description
        );

        // ссылка на карту / сайт
        const newLink =
          placeBlock.map_url ||
          p.map_url ||
          p.url ||
          null;

        // часы работы: поддерживаем place.hours и p.hours
        const hoursRaw =
          (placeBlock.hours && String(placeBlock.hours).trim()) ||
          (p.hours && String(p.hours).trim()) ||
          null;

        // тип места
        const typeFromJson = mapTypeFromJson(p);

        const existing = byName.get(name);

        if (existing) {
          // === Обновляем существующую запись ===
          // name и image НЕ трогаем
          // тип: если из JSON удалось определить — берём его
          // (если хочешь не затирать ручные значения — можно поменять логику)
          const typeToSet =
            typeFromJson || existing.type || "Коворкинг / антикафе";

          // город: сохраняем существующий, если уже есть, иначе по умолчанию Москва
          const cityToSet = existing.city || "Москва";

          const addressToSet = parsedAddress || existing.address || null;
          const badgeToSet = existing.badge || null;

          const ratingToSet =
            newRating !== null ? newRating : existing.rating;
          const reviewsToSet =
            newReviews !== null ? newReviews : existing.reviews;

          const featuresToSet =
            featuresJson !== null ? featuresJson : existing.features;

          const linkToSet = newLink || existing.link || null;

          const descriptionToSet =
            description || existing.description || null;

          const hoursToSet =
            hoursRaw || existing.hours || null;

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
            existing.id,
            (uErr) => {
              if (uErr) {
                console.error(`❌ Ошибка UPDATE для "${name}":`, uErr);
              } else {
                updated++;
              }
            }
          );
        } else {
          // === Нет в БД — добавляем новую запись ===

          // первая картинка из photo_urls (для новых мест)
          const imageFromJson =
            Array.isArray(p.photo_urls) && p.photo_urls.length > 0
              ? p.photo_urls[0]
              : null;

          const typeToSet = typeFromJson || "Коворкинг / антикафе";

          // по kowo_full все места, скорее всего, Москва — задаём дефолт
          const cityToSet = "Москва";

          const badgeToSet = null;

          insertStmt.run(
            name,               // name
            typeToSet,          // type
            cityToSet,          // city
            parsedAddress,      // address
            imageFromJson,      // image
            badgeToSet,         // badge
            newRating,          // rating
            newReviews,         // reviews
            featuresJson,       // features
            newLink,            // link
            description,        // description
            hoursRaw,           // hours
            (iErr) => {
              if (iErr) {
                console.error(`❌ Ошибка INSERT для "${name}":`, iErr);
              } else {
                inserted++;
              }
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