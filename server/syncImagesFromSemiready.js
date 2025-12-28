// server/syncImagesFromSemiready.js
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";

sqlite3.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Можно переопределить путями из аргументов:
// node syncImagesFromSemiready.js ../users-semiready.db ../users-backup.db --dry-run
const args = process.argv.slice(2);
const srcArg = args.find((a) => a.endsWith(".db"));
const dstArg = args.filter((a) => a.endsWith(".db"))[1];
const dryRun = args.includes("--dry-run");

const srcPath = srcArg
  ? path.resolve(process.cwd(), srcArg)
  : path.join(__dirname, "users-semiready.db");

const dstPath = dstArg
  ? path.resolve(process.cwd(), dstArg)
  : path.join(__dirname, "users-backup.db");

console.log("Источник (чистые фото):", srcPath);
console.log("Назначение (обновим фото):", dstPath);
console.log("Режим:", dryRun ? "DRY RUN (без записи)" : "WRITE (с записью)");

function normalizeName(str = "") {
  return String(str)
    .toLowerCase()
    .replace(/[ъ']/g, "ь")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "")
    .trim();
}

function safeParseImages(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
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

async function ensureImagesColumn(db, table = "places") {
  const cols = await dbAll(db, `PRAGMA table_info(${table})`);
  const hasImages = cols.some((c) => c.name === "images");
  if (!hasImages) {
    console.log(`Колонки images нет в ${table} — добавляю...`);
    await dbRun(db, `ALTER TABLE ${table} ADD COLUMN images TEXT`);
    console.log(`Колонка images добавлена.`);
  }
}

async function main() {
  const srcDb = new sqlite3.Database(srcPath, sqlite3.OPEN_READONLY);
  const dstDb = new sqlite3.Database(dstPath, sqlite3.OPEN_READWRITE);

  try {
    // На всякий случай гарантируем, что в целевой БД есть images
    await ensureImagesColumn(dstDb, "places");

    // Читаем источники
    const srcRows = await dbAll(
      srcDb,
      "SELECT id, name, image, images FROM places"
    );

    const dstRows = await dbAll(
      dstDb,
      "SELECT id, name, image, images FROM places"
    );

    // Индексы источника по id и по имени
    const srcById = new Map();
    const srcByName = new Map();

    for (const r of srcRows) {
      const id = Number(r.id);
      const name = (r.name || "").trim();
      const key = normalizeName(name);

      const imagesArr = safeParseImages(r.images);
      const cover = r.image || imagesArr[0] || null;

      const payload = {
        id,
        name,
        image: cover,
        images: imagesArr.length ? imagesArr : cover ? [cover] : [],
      };

      if (Number.isFinite(id)) srcById.set(id, payload);
      if (key) srcByName.set(key, payload);
    }

    const updateSql = "UPDATE places SET image = ?, images = ? WHERE id = ?";

    let processed = 0;
    let updated = 0;
    let unchanged = 0;
    let notFound = 0;

    for (const d of dstRows) {
      processed++;
      const dstId = Number(d.id);
      const dstName = (d.name || "").trim();
      const dstKey = normalizeName(dstName);

      // 1) пробуем матч по id
      let src = Number.isFinite(dstId) ? srcById.get(dstId) : null;

      // 2) если не нашли — матч по имени
      if (!src && dstKey) src = srcByName.get(dstKey);

      if (!src) {
        notFound++;
        continue;
      }

      const newImage = src.image || null;
      const newImagesJson = JSON.stringify(src.images || []);

      const oldImagesArr = safeParseImages(d.images);
      const oldImagesJson = JSON.stringify(oldImagesArr || []);
      const oldImage = d.image || null;

      const isSame =
        (oldImage || null) === (newImage || null) &&
        oldImagesJson === newImagesJson;

      if (isSame) {
        unchanged++;
        continue;
      }

      if (!dryRun) {
        await dbRun(dstDb, updateSql, [newImage, newImagesJson, dstId]);
      }

      updated++;
      if (updated % 50 === 0) {
        console.log(`...обновлено ${updated}`);
      }
    }

    console.log("====== ГОТОВО ======");
    console.log("Всего мест в целевой:", dstRows.length);
    console.log("Обработано:", processed);
    console.log("Обновлено:", updated);
    console.log("Без изменений:", unchanged);
    console.log("Не найдено соответствий:", notFound);

    if (dryRun) {
      console.log("Это был DRY RUN — база НЕ изменена.");
    }
  } catch (e) {
    console.error("Ошибка синхронизации:", e);
    process.exitCode = 1;
  } finally {
    srcDb.close();
    dstDb.close();
  }
}

main();