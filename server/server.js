// server/server.js
import express from "express";
import cors from "cors";
import db from "./db.js";
import { suggestCities, cityExists } from "./cities.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer"; // 🔹 для загрузки файлов

import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config({ override: true });

const app = express();
app.set("trust proxy", 1); // ✅ важно за nginx/https
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "0.0.0.0";

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Telegram notify failed:", res.status, body);
    }
  } catch (e) {
    console.error("Telegram notify failed:", e);
  }
}

const envOrigins = [
  process.env.CLIENT_ORIGIN,
  ...(process.env.CLIENT_ORIGINS ? process.env.CLIENT_ORIGINS.split(",") : []),
]
  .map((origin) => (origin || "").trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  ...envOrigins,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://allspace.com.ru",
  "https://www.allspace.com.ru",
]);
const allowAllOrigins = process.env.CORS_ALLOW_ALL === "true";

app.use(
  cors({
    origin(origin, cb) {
      // запросы без Origin (например healthcheck/cron)
      if (!origin) return cb(null, true);
      if (allowAllOrigins) return cb(null, true);
      return cb(null, allowedOrigins.has(origin));
    },
    credentials: true,
  })
);
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Работа с фото
const photosRoot = path.join(__dirname, "photos");
if (!fs.existsSync(photosRoot)) {
  fs.mkdirSync(photosRoot, { recursive: true });
}

// Папка для загруженных через /api/upload картинок
const uploadRoot = path.join(photosRoot, "uploads");
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

// 🔹 настройка multer
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadRoot);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname) || "";
    const base =
      path
        .basename(file.originalname, ext)
        .toLowerCase()
        .replace(/[^a-z0-9а-я]+/gi, "-")
        .slice(0, 40) || "file";
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${base}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB на файл (подбери под себя)
    files: 20,
  },
});

function normalizeKey(str = "") {
  return str
    .toLowerCase()
    .replace(/[ъ']/g, "ь")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

function extractFolderFromImage(imageUrl = "") {
  const marker = "/photos/";
  const idx = imageUrl.indexOf(marker);
  if (idx === -1) return null;
  const raw = imageUrl.slice(idx + marker.length).split("/")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function findFolderByName(name = "") {
  if (!fs.existsSync(photosRoot)) return null;
  const target = normalizeKey(name);
  return (
    fs
      .readdirSync(photosRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .find((dir) => {
        const norm = normalizeKey(dir);
        return norm === target || norm.includes(target) || target.includes(norm);
      }) || null
  );
}

function listPhotos(folder, req) {
  if (!folder) return [];
  const folderPath = path.join(photosRoot, folder);
  if (!fs.existsSync(folderPath)) return [];

  return fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => f.name)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((f) => `/photos/${encodeURIComponent(folder)}/${encodeURIComponent(f)}`);
}

function collectPlacePhotos(place, req) {
  // Хелпер: нормализуем URL так, чтобы /photos всегда были относительными
  const normalizeMedia = (url) => {
    if (!url) return null;

    const s = String(url).trim();

    // data: оставляем как есть
    if (/^data:/i.test(s)) return s;

    // ✅ ВАЖНО: если это абсолютный URL и внутри есть /photos/..., режем домен -> оставляем /photos/...
    // Пример: http://localhost:3001/photos/x/y.webp  -> /photos/x/y.webp
    //         https://api.allspace.com.ru/photos/...  -> /photos/...
    const photosMatch = s.match(/^https?:\/\/[^/]+(\/photos\/.*)$/i);
    if (photosMatch) return photosMatch[1];

    // Абсолютные (внешние) ссылки оставляем как есть
    if (/^https?:\/\//i.test(s)) return s;

    // Уже относительный путь от корня сайта
    if (s.startsWith("/")) return s;

    // "голое" имя -> считаем, что это фото в /photos/...
    return `/photos/${s}`;
  };

  // 1) Если в БД задан images[] — нормализуем каждую ссылку
  if (Array.isArray(place?.images) && place.images.length) {
    const photos = place.images
      .map(normalizeMedia)
      .filter(Boolean);

    const cover = normalizeMedia(photos[0] || place.image || null);
    return { photos, cover };
  }

  // 2) Легаси-режим: папка из image/url/имени -> listPhotos уже вернёт /photos/...
  const firstImage = Array.isArray(place?.images) ? place.images[0] : null;
  const folder =
    extractFolderFromImage(place?.image || "") ||
    extractFolderFromImage(firstImage || "") ||
    findFolderByName(place?.name || "");

  const photos = listPhotos(folder, req);

  const cover = normalizeMedia(photos[0] || place?.image || null);
  return { photos, cover };
}

function enrichPlaceForClient(place, req) {
  const { photos, cover } = collectPlacePhotos(place, req);

  const normalizeMedia = (url) => {
    if (!url) return null;

    const s = String(url).trim();
    if (/^data:/i.test(s)) return s;

    // Режем любой абсолютный URL с /photos/... -> /photos/...
    const photosMatch = s.match(/^https?:\/\/[^/]+(\/photos\/.*)$/i);
    if (photosMatch) return photosMatch[1];

    // Внешние абсолютные ссылки оставляем
    if (/^https?:\/\//i.test(s)) return s;

    if (s.startsWith("/")) return s;
    return `/photos/${s}`;
  };

  const normalizedPhotos =
    Array.isArray(photos) && photos.length
      ? photos.map(normalizeMedia).filter(Boolean)
      : [];

  const normalizedImage = normalizeMedia(cover || place.image || null);

  return {
    ...place,
    image: normalizedImage,
    images: normalizedPhotos.length ? normalizedPhotos : (place.images || []),
  };
}

// ✅ статическая раздача фото
app.use("/photos", express.static(path.join(__dirname, "photos")));


// ===================== AVATARS =====================
const avatarsRoot = path.join(__dirname, "avatars");
if (!fs.existsSync(avatarsRoot)) {
  fs.mkdirSync(avatarsRoot, { recursive: true });
}

// статическая раздача аватарок
app.use("/avatars", express.static(avatarsRoot));

// отдельный multer для аватаров (файл называется по userId)
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, avatarsRoot);
    },
    filename(req, file, cb) {
      const userId = String(req.params.id || "unknown");
      const ext = (path.extname(file.originalname) || ".png").toLowerCase();
      cb(null, `${userId}${ext}`); // например: 12.png
    },
  }),
  fileFilter(req, file, cb) {
    const ok = /\.(jpe?g|png|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error("Only jpg/png/webp allowed"), ok);
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});


// 🔹 API загрузки фото: /api/upload
app.post("/api/upload", upload.array("files", 20), (req, res) => {
  try {
    const host = `${req.protocol}://${req.get("host")}`;
    const files = req.files || [];
    if (!files.length) {
      return res.json({ ok: true, urls: [] });
    }
    const urls = files.map(
      (f) =>
        `${host}/photos/uploads/${encodeURIComponent(path.basename(f.filename))}`
    );
    return res.json({ ok: true, urls });
  } catch (e) {
    console.error("Upload error:", e);
    return res
      .status(500)
      .json({ ok: false, message: "Ошибка загрузки файлов" });
  }
});

// ===================== PLACES: таблица и начальное наполнение =====================

// создаём таблицу places, если её ещё нет
// ===================== PLACES + USERS + REVIEWS: таблицы и миграции =====================

db.serialize(() => {
  // --- 1) Таблица PLACES ---
  db.run(`
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      city TEXT,
      address TEXT,
      image TEXT,
      images TEXT, -- JSON-массив ссылок на картинки
      badge TEXT,
      rating REAL,
      reviews INTEGER,
      features TEXT, -- JSON-строка с массивом фич
      link TEXT,
      hours TEXT,
      phone TEXT,
      moderation_status TEXT DEFAULT 'approved',
      submitted_by TEXT,
      submitted_at INTEGER
    )
  `);

  // --- 2) Таблица PLACE_REVIEWS ---
  // ВАЖНО: добавили user_id (связь с users)
  db.run(`
    CREATE TABLE IF NOT EXISTS place_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER NOT NULL,
      user_id INTEGER,             -- ✅ связь с users.id
      user_login TEXT,
      user_name TEXT,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      text TEXT NOT NULL,
      images TEXT,                 -- JSON array of review photo URLs
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE
    )
  `);

  // Индексы
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_place_reviews_place_id ON place_reviews(place_id)"
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_place_reviews_user_id ON place_reviews(user_id)"
  );


    // ===================== ARTICLES =====================
    db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      cover_image TEXT NOT NULL,        -- обязательная обложка (/photos/..)
      content_json TEXT NOT NULL,       -- JSON блоков (как телеграф)
      excerpt TEXT,
      status TEXT DEFAULT 'draft',      -- draft | pending | approved | rejected
      display_order INTEGER DEFAULT 0,  -- порядок вывода на сайте
      author_id INTEGER,
      author_login TEXT,
      submitted_at INTEGER,
      published_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS article_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      user_id INTEGER,
      user_login TEXT,
      user_name TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS article_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      user_id INTEGER,
      user_login TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(article_id, user_id, user_login)
    )
  `);

    // ===================== ANALYTICS =====================
    db.run(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,          -- session_start, session_end, place_card_click ...
      path TEXT,
      referrer TEXT,
      source TEXT,
      ip TEXT,
      user_agent TEXT,
      device_type TEXT,
      visitor_id TEXT,                   -- из localStorage фронта
      session_id TEXT,                   -- на одну сессию/вкладку
      visitor_key TEXT,                  -- fallback/нормализованный ключ
      session_key TEXT,                  -- fallback/нормализованный ключ
      entity_type TEXT,                  -- place | article | popup | session
      entity_id TEXT,
      entity_title TEXT,
      payload_json TEXT,
      duration_sec INTEGER,              -- для session_end
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_analytics_event_name
    ON analytics_events(event_name)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_analytics_created_at
    ON analytics_events(created_at)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_analytics_session_key
    ON analytics_events(session_key)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_analytics_visitor_key
    ON analytics_events(visitor_key)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_analytics_entity
    ON analytics_events(entity_type, entity_id)
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_articles_order ON articles(display_order)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_article_comments_article ON article_comments(article_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_article_fav_article ON article_favorites(article_id)`);

  // --- 3) МИГРАЦИИ PLACES: добавляем недостающие колонки ---
  db.all("PRAGMA table_info(places)", (err, columns) => {
    if (err) {
      console.error("Ошибка PRAGMA table_info(places):", err);
      return;
    }

    const colNames = new Set((columns || []).map((c) => c.name));

    if (!colNames.has("images")) {
      db.run("ALTER TABLE places ADD COLUMN images TEXT", (e) => {
        if (e) console.error("Ошибка добавления images в places:", e);
        else console.log("Столбец images добавлен в таблицу places");
      });
    }

    if (!colNames.has("hours")) {
      db.run("ALTER TABLE places ADD COLUMN hours TEXT", (e) => {
        if (e) console.error("Ошибка добавления hours в places:", e);
        else console.log("Столбец hours добавлен в таблицу places");
      });
    }

    if (!colNames.has("phone")) {
      db.run("ALTER TABLE places ADD COLUMN phone TEXT", (e) => {
        if (e) console.error("Ошибка добавления phone в places:", e);
        else console.log("Столбец phone добавлен в таблицу places");
      });
    }

    if (!colNames.has("moderation_status")) {
      db.run("ALTER TABLE places ADD COLUMN moderation_status TEXT DEFAULT 'approved'", (e) => {
        if (e) console.error("Ошибка добавления moderation_status в places:", e);
        else console.log("Столбец moderation_status добавлен в таблицу places");
      });
    }

    if (!colNames.has("submitted_by")) {
      db.run("ALTER TABLE places ADD COLUMN submitted_by TEXT", (e) => {
        if (e) console.error("Ошибка добавления submitted_by в places:", e);
        else console.log("Столбец submitted_by добавлен в таблицу places");
      });
    }

    if (!colNames.has("submitted_at")) {
      db.run("ALTER TABLE places ADD COLUMN submitted_at INTEGER", (e) => {
        if (e) console.error("Ошибка добавления submitted_at в places:", e);
        else console.log("Столбец submitted_at добавлен в таблицу places");
      });
    }
  });

  // --- 4) МИГРАЦИИ USERS: avatar ---
  // ✅ исправлено: проверяем именно users, а не places
  db.all("PRAGMA table_info(users)", (err, columns) => {
    if (err) {
      console.error("Ошибка PRAGMA table_info(users):", err);
      return;
    }

    const colNames = new Set((columns || []).map((c) => c.name));

    if (!colNames.has("avatar")) {
      db.run("ALTER TABLE users ADD COLUMN avatar TEXT", (e) => {
        if (e) console.error("Ошибка добавления avatar в users:", e);
        else console.log("Столбец avatar добавлен в таблицу users");
      });
    }
  });

  // --- 5) МИГРАЦИИ PLACE_REVIEWS: user_id + backfill ---
  // ✅ добавляем user_id, если таблица уже существовала без него
  db.all("PRAGMA table_info(place_reviews)", (err, columns) => {
    if (err) {
      console.error("Ошибка PRAGMA table_info(place_reviews):", err);
      return;
    }

    const colNames = new Set((columns || []).map((c) => c.name));

    if (!colNames.has("images")) {
      db.run("ALTER TABLE place_reviews ADD COLUMN images TEXT", (e) => {
        if (e) console.error("DB error (add images to place_reviews):", e);
        else console.log("Column images added to place_reviews");
      });
    }

    // 5.1) добавить колонку user_id
    if (!colNames.has("user_id")) {
      db.run("ALTER TABLE place_reviews ADD COLUMN user_id INTEGER", (e) => {
        if (e) {
          console.error("Ошибка добавления user_id в place_reviews:", e);
          return;
        }
        console.log("Столбец user_id добавлен в таблицу place_reviews");

        // 5.2) backfill: проставим user_id по user_login (если совпадает)
        // Если у тебя логин в отзывах всегда совпадает с users.login — это заполнит корректно.
        const backfillSql = `
          UPDATE place_reviews
          SET user_id = (
            SELECT u.id FROM users u
            WHERE u.login = place_reviews.user_login
            LIMIT 1
          )
          WHERE user_id IS NULL AND user_login IS NOT NULL
        `;
        db.run(backfillSql, (e2) => {
          if (e2) console.error("Ошибка backfill user_id:", e2);
          else console.log("Backfill user_id в place_reviews выполнен");
        });
      });
    } else {
      // даже если колонка есть — можно один раз попытаться добить пропуски
      const backfillSql = `
        UPDATE place_reviews
        SET user_id = (
          SELECT u.id FROM users u
          WHERE u.login = place_reviews.user_login
          LIMIT 1
        )
        WHERE user_id IS NULL AND user_login IS NOT NULL
      `;
      db.run(backfillSql, (e2) => {
        if (e2) console.error("Ошибка backfill user_id:", e2);
        else console.log("Backfill user_id (повторный) выполнен");
      });
    }
  });

  // --- 6) Импорт places.json (один раз, если places пустая) ---
  const placesJsonPath = path.join(__dirname, "../src/places.json");

  db.get("SELECT COUNT(*) AS cnt FROM places", (err, row) => {
    if (err) {
      console.error("Ошибка подсчёта places:", err);
      return;
    }

    if (row && row.cnt === 0 && fs.existsSync(placesJsonPath)) {
      console.log("Таблица places пуста, импортируем данные из places.json...");
      try {
        const raw = fs.readFileSync(placesJsonPath, "utf8");
        const placesFromJson = JSON.parse(raw);

        const insertSql = `
          INSERT INTO places
            (name, type, city, address, image, images, badge, rating, reviews, features, link, hours, phone)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const stmt = db.prepare(insertSql);

        for (const p of placesFromJson) {
          const featuresJson = JSON.stringify(p.features || []);
          const imagesJson = JSON.stringify(p.images || []);

          stmt.run(
            p.name || "",
            p.type || null,
            p.city || null,
            p.address || null,
            p.image || null,
            imagesJson,
            p.badge || null,
            typeof p.rating === "number" ? p.rating : null,
            typeof p.reviews === "number" ? p.reviews : null,
            featuresJson,
            p.link || null,
            p.hours || null,
            p.phone || null
          );
        }

        stmt.finalize();
        console.log("Импорт places.json в БД завершён.");
      } catch (e) {
        console.error("Ошибка импорта places.json:", e);
      }
    }
  });
});

// хелпер для преобразования строки features / images в объекты
function mapPlaceRow(row) {
  let features = [];
  try {
    features = row.features ? JSON.parse(row.features) : [];
  } catch (e) {
    features = [];
  }

  let images = [];
  try {
    images = row.images ? JSON.parse(row.images) : [];
  } catch (e) {
    images = [];
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    city: row.city,
    address: row.address,
    image: row.image,
    images,
    badge: row.badge,
    rating: row.rating,
    reviews: row.reviews,
    features,
    link: row.link,
    hours: row.hours || null,
    phone: row.phone || null,
    moderation_status: row.moderation_status || "approved",
    submitted_by: row.submitted_by || null,
    submitted_at: row.submitted_at || null,
  };
}

function mapReviewRow(row, req) {
  const createdAtSec = Number(row.created_at || 0);
  const createdAt = createdAtSec
    ? new Date(createdAtSec * 1000).toISOString()
    : new Date().toISOString();

  const host = req ? `${req.protocol}://${req.get("host")}` : "";
  const avatarRaw = row.user_avatar || null;

  const userAvatar = avatarRaw
    ? (String(avatarRaw).startsWith("http") ? avatarRaw : `${host}${avatarRaw}`)
    : null;

  const normalizeReviewMedia = (url) => {
    if (!url) return null;
    const s = String(url).trim();
    if (/^data:/i.test(s)) return s;
    const photosMatch = s.match(/^https?:\/\/[^/]+(\/photos\/.*)$/i);
    if (photosMatch) return photosMatch[1];
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("/")) return s;
    return `/photos/${s}`;
  };

  let images = [];
  try {
    images = row.images ? JSON.parse(row.images) : [];
  } catch (e) {
    images = [];
  }

  const normalizedImages = Array.isArray(images)
    ? images.map(normalizeReviewMedia).filter(Boolean)
    : [];

  return {
    id: row.id,
    placeId: row.place_id,
    userId: row.user_id ?? null,
    userLogin: row.user_login || null,
    userName: row.user_name || null,
    userAvatar, // ✅ добавили
    rating: row.rating,
    text: row.text,
    images: normalizedImages,
    createdAt,
  };
}

function recalcPlaceRating(placeId, cb = () => {}) {
  const sql = `
    SELECT COUNT(*) AS cnt, AVG(rating) AS avgRating
    FROM place_reviews
    WHERE place_id = ?
  `;

  db.get(sql, [placeId], (err, row) => {
    if (err) return cb(err);

    const total = Number(row?.cnt ?? 0);
    const avgRaw = row?.avgRating;
    const avg =
      avgRaw === null || avgRaw === undefined
        ? null
        : Math.round(Number(avgRaw) * 10) / 10;

    db.run(
      "UPDATE places SET rating = ?, reviews = ? WHERE id = ?",
      [total > 0 ? avg : null, total, placeId],
      (updateErr) => cb(updateErr, { total, average: total > 0 ? avg : null })
    );
  });
}

function resolveRequestUser(req, cb) {
  const { userId, userLogin } = req.body || {};
  const safeUserId = Number.isInteger(Number(userId)) ? Number(userId) : null;
  const loginFromBody = typeof userLogin === "string" ? userLogin.trim() : "";

  if (!safeUserId) {
    return cb(null, {
      id: null,
      login: loginFromBody || null,
      isAdmin: loginFromBody === "admin",
    });
  }

  db.get("SELECT id, login FROM users WHERE id = ?", [safeUserId], (err, row) => {
    if (err) return cb(err);
    const login = row?.login || loginFromBody || null;
    return cb(null, {
      id: row?.id ?? safeUserId,
      login,
      isAdmin: login === "admin",
    });
  });
}

function mapArticleRow(row, req) {
  let content = [];
  try {
    content = row.content_json ? JSON.parse(row.content_json) : [];
  } catch {
    content = [];
  }

  const host = req ? `${req.protocol}://${req.get("host")}` : "";

  const normalizeAvatar = (avatarRaw) => {
    if (!avatarRaw) return null;
    return String(avatarRaw).startsWith("http") ? avatarRaw : `${host}${avatarRaw}`;
  };

  const createdAtSec = Number(row.created_at || 0);
  const publishedAtSec = Number(row.published_at || 0);

  const createdAtHuman = createdAtSec
    ? new Date(createdAtSec * 1000).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  const publishedAtHuman = publishedAtSec
    ? new Date(publishedAtSec * 1000).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  const authorName = [row.author_first_name, row.author_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    id: row.id,
    title: row.title,
    coverImage: row.cover_image,
    content,
    excerpt: row.excerpt || "",
    status: row.status || "draft",
    displayOrder: Number(row.display_order || 0),
    authorId: row.author_id ?? null,
    authorLogin: row.author_login || null,
    authorName: authorName || row.author_login || null,
    authorAvatar: normalizeAvatar(row.author_avatar || null),
    submittedAt: row.submitted_at || null,
    publishedAt: row.published_at || null,
    publishedAtHuman,
    createdAt: row.created_at || null,
    createdAtHuman,
    updatedAt: row.updated_at || null,
  };
}

function mapArticleCommentRow(row, req) {
  const createdAtSec = Number(row.created_at || 0);
  const createdAt = createdAtSec
    ? new Date(createdAtSec * 1000).toISOString()
    : new Date().toISOString();

  const host = req ? `${req.protocol}://${req.get("host")}` : "";
  const avatarRaw = row.user_avatar || null;

  const userAvatar = avatarRaw
    ? (String(avatarRaw).startsWith("http") ? avatarRaw : `${host}${avatarRaw}`)
    : null;

  return {
    id: row.id,
    articleId: row.article_id,
    userId: row.user_id ?? null,
    userLogin: row.user_login || null,
    userName: row.user_name || null,
    userAvatar,
    text: row.text,
    createdAt,
  };
}

function normalizeArticleMedia(url) {
  if (!url) return null;
  const s = String(url).trim();
  if (/^data:/i.test(s)) return s;
  const photosMatch = s.match(/^https?:\/\/[^/]+(\/photos\/.*)$/i);
  if (photosMatch) return photosMatch[1];
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return s;
  return `/photos/${s}`;
}

// ===================== ANALYTICS HELPERS =====================

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0].trim();
  }
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function normalizeUa(ua = "") {
  return String(ua || "").slice(0, 500);
}

function detectDeviceType(userAgent = "") {
  const ua = String(userAgent || "").toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return "tablet";
  if (/mobi|android|iphone|ipod|windows phone/.test(ua)) return "mobile";
  return "desktop";
}

function detectSource(referrer = "") {
  const ref = String(referrer || "").toLowerCase().trim();
  if (!ref) return "direct";

  if (ref.includes("t.me") || ref.includes("telegram")) return "telegram";
  if (ref.includes("google.")) return "google";
  if (ref.includes("yandex.")) return "yandex";
  if (ref.includes("vk.com")) return "vk";
  if (ref.includes("instagram.") || ref.includes("l.instagram.")) return "instagram";
  if (ref.includes("facebook.") || ref.includes("fb.")) return "facebook";
  if (ref.includes("twitter.") || ref.includes("x.com")) return "x";
  if (ref.includes("linkedin.")) return "linkedin";

  return "other";
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatDurationHuman(totalSec) {
  const sec = Math.max(0, Math.round(Number(totalSec || 0)));
  if (!sec) return "0 сек";

  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;

  if (!minutes) return `${seconds} сек`;
  return `${minutes} мин ${String(seconds).padStart(2, "0")} сек`;
}

// ===================== SMTP НАСТРОЙКА =====================

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// временное хранилище незавершённых регистраций (для dev)
const pendingRegistrations = new Map();

// ===================== ЛОГИН =====================

app.post("/api/login", (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({
      ok: false,
      message: "Логин и пароль обязательны",
    });
  }

  const sql = `
    SELECT
      id,
      login,
      first_name,
      last_name,
      city,
      email,
      status,
      avatar
    FROM users
    WHERE login = ? AND password = ?
  `;

  db.get(sql, [login, password], (err, row) => {
    if (err) {
      console.error("DB error (login):", err);
      return res.status(500).json({
        ok: false,
        message: "Ошибка сервера",
      });
    }

    if (!row) {
      return res.json({
        ok: false,
        message: "Неверный логин или пароль",
      });
    }

    const host = `${req.protocol}://${req.get("host")}`;

    const user = {
      id: row.id,
      login: row.login,
      first_name: row.first_name,
      last_name: row.last_name,
      city: row.city,
      email: row.email,
      status: row.status,
      avatar: row.avatar ? (row.avatar.startsWith("http") ? row.avatar : `${host}${row.avatar}`) : null,
    };

    return res.json({
      ok: true,
      message: "ок",
      user,
    });
  });
});

// ===================== РЕГИСТРАЦИЯ: ШАГ 1 =====================

app.post("/api/register/start", (req, res) => {
  const { login, password, firstName, lastName, city, email, status, hours, phone} = req.body;

  if (!login || !password) {
    return res.status(400).json({
      ok: false,
      message: "Логин и пароль обязательны",
    });
  }

  if (!email) {
    return res.status(400).json({
      ok: false,
      message: "Емейл обязателен",
    });
  }

  if (!cityExists(city)) {
    return res.json({
      ok: false,
      message: "Город не найден в справочнике",
    });
  }

  db.get("SELECT id FROM users WHERE login = ?", [login], (err, row) => {
    if (err) {
      console.error("DB error (check login):", err);
      return res.status(500).json({
        ok: false,
        message: "Ошибка сервера",
      });
    }

    if (row) {
      return res.json({
        ok: false,
        message: "Пользователь с таким логином уже существует",
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000;

    const userData = {
      login,
      password,
      firstName,
      lastName,
      city,
      email,
      status,
    };

    pendingRegistrations.set(email, {
      code,
      userData,
      expiresAt,
    });

    const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;

    transporter.sendMail(
      {
        from: `"Space Landing" <${fromEmail}>`,
        to: email,
        subject: "Код подтверждения почты",
        text: `Ваш код подтверждения: ${code}. Он действителен 15 минут.`,
      },
      (mailErr, info) => {
        if (mailErr) {
          console.error("Ошибка отправки письма:", mailErr);
          return res.json({
            ok: false,
            message: "Не удалось отправить код на почту",
          });
        }

        console.log("Код подтверждения отправлен:", info.messageId);
        return res.json({ ok: true });
      }
    );
  });
});

// ===================== РЕГИСТРАЦИЯ: ШАГ 2 =====================

app.post("/api/register/verify", (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({
      ok: false,
      message: "Емейл и код обязательны",
    });
  }

  const record = pendingRegistrations.get(email);
  if (!record) {
    return res.json({
      ok: false,
      message: "Нет ожидающей регистрации для этой почты или код просрочен",
    });
  }

  if (Date.now() > record.expiresAt) {
    pendingRegistrations.delete(email);
    return res.json({
      ok: false,
      message: "Код истёк, запросите новый",
    });
  }

  if (record.code !== code) {
    return res.json({
      ok: false,
      message: "Неверный код",
    });
  }

  const { login, password, firstName, lastName, city, status } = record.userData;

  db.get("SELECT id FROM users WHERE login = ?", [login], (err, row) => {
    if (err) {
      console.error("DB error (check login on verify):", err);
      return res.status(500).json({
        ok: false,
        message: "Ошибка сервера",
      });
    }

    if (row) {
      return res.json({
        ok: false,
        message: "Пользователь с таким логином уже существует",
      });
    }

    const sql = `
      INSERT INTO users
        (login, password, first_name, last_name, city, email, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      sql,
      [login, password, firstName, lastName, city, email, status],
      function (insertErr) {
        if (insertErr) {
          console.error("DB error (insert user on verify):", insertErr);
          return res.status(500).json({
            ok: false,
            message: "Ошибка сервера при регистрации",
          });
        }

        pendingRegistrations.delete(email);

        return res.json({
          ok: true,
          message: "ок",
        });
      }
    );
  });
});


// ===================== USERS PROFILE =====================

// Получить пользователя по логину (нужно, если в localStorage нет id)
app.get("/api/users/by-login/:login", (req, res) => {
  const login = req.params.login;
  const sql = `
    SELECT id, login, first_name, last_name, city, email, status, avatar
    FROM users
    WHERE login = ?
  `;
  db.get(sql, [login], (err, row) => {
    if (err) {
      console.error("DB error (get user by login):", err);
      return res.status(500).json({ ok: false, message: "DB error" });
    }
    if (!row) return res.status(404).json({ ok: false, message: "User not found" });

    const host = `${req.protocol}://${req.get("host")}`;
    return res.json({
      ok: true,
      user: {
        id: row.id,
        login: row.login,
        first_name: row.first_name,
        last_name: row.last_name,
        city: row.city,
        email: row.email,
        status: row.status,
        avatar: row.avatar ? (row.avatar.startsWith("http") ? row.avatar : `${host}${row.avatar}`) : null,
      },
    });
  });
});

app.get("/api/articles/:id/favorite-state", (req, res) => {
  const articleId = Number(req.params.id);
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const userLogin = (req.query.userLogin || "").trim();

  if (!Number.isInteger(articleId)) return res.status(400).json({ ok: false, message: "Invalid id" });
  if (!userId && !userLogin) return res.json({ ok: true, isFav: false });

  const sql = userId
    ? `SELECT 1 FROM article_favorites WHERE article_id = ? AND user_id = ? LIMIT 1`
    : `SELECT 1 FROM article_favorites WHERE article_id = ? AND user_login = ? LIMIT 1`;

  const params = userId ? [articleId, userId] : [articleId, userLogin];

  db.get(sql, params, (err, row) => {
    if (err) return res.status(500).json({ ok: false, message: "DB error" });
    return res.json({ ok: true, isFav: !!row });
  });
});

// Обновить данные профиля
app.put("/api/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  // принимаем и camelCase, и snake_case
  const firstName = (req.body.firstName ?? req.body.first_name ?? "").trim();
  const lastName = (req.body.lastName ?? req.body.last_name ?? "").trim();
  const city = (req.body.city ?? "").trim();
  const email = (req.body.email ?? "").trim();
  const status = (req.body.status ?? "").trim();

  const sql = `
    UPDATE users
    SET first_name = ?, last_name = ?, city = ?, email = ?, status = ?
    WHERE id = ?
  `;

  db.run(sql, [firstName || null, lastName || null, city || null, email || null, status || null, id], function (err) {
    if (err) {
      console.error("DB error (update user):", err);
      return res.status(500).json({ ok: false, message: "DB error" });
    }
    if (this.changes === 0) return res.status(404).json({ ok: false, message: "User not found" });

    // ✅ Обновляем user_name во всех отзывах этого пользователя
    db.get("SELECT id, login, first_name, last_name FROM users WHERE id = ?", [id], (uErr, uRow) => {
      if (uErr || !uRow) {
        // если что-то пошло не так — просто вернём обновлённого юзера ниже как раньше
        console.error("DB error (fetch user after update):", uErr);
        return continueReturnUser();
      }

      const displayName = [uRow.first_name, uRow.last_name].filter(Boolean).join(" ").trim();
      const finalUserName = displayName || uRow.login || null;

      db.run(
        "UPDATE place_reviews SET user_name = ? WHERE user_id = ?",
        [finalUserName, id],
        (rErr) => {
          if (rErr) console.error("DB error (update reviews user_name):", rErr);
          return continueReturnUser();
        }
      );
    });

    function continueReturnUser() {
      db.get("SELECT id, login, first_name, last_name, city, email, status, avatar FROM users WHERE id = ?", [id], (err2, row) => {
        if (err2 || !row) return res.json({ ok: true });

        const host = `${req.protocol}://${req.get("host")}`;
        return res.json({
          ok: true,
          user: {
            id: row.id,
            login: row.login,
            first_name: row.first_name,
            last_name: row.last_name,
            city: row.city,
            email: row.email,
            status: row.status,
            avatar: row.avatar ? (row.avatar.startsWith("http") ? row.avatar : `${host}${row.avatar}`) : null,
          },
        });
      });
    }

    return; // важно: чтобы ниже код не отработал второй раз
  });
});

// Загрузка аватарки (файл будет называться по id: 12.png / 12.jpg и т.п.)
app.post("/api/users/:id/avatar", avatarUpload.single("avatar"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  if (!req.file) return res.status(400).json({ ok: false, message: "No file" });

  const relPath = `/avatars/${req.file.filename}`; // храним в БД относительный путь
  db.run("UPDATE users SET avatar = ? WHERE id = ?", [relPath, id], function (err) {
    if (err) {
      console.error("DB error (update avatar):", err);
      return res.status(500).json({ ok: false, message: "DB error" });
    }
    const host = `${req.protocol}://${req.get("host")}`;
    return res.json({ ok: true, avatar: `${host}${relPath}` });
  });
});


// ===================== ПОДСКАЗКИ ГОРОДОВ =====================

app.get("/api/cities", (req, res) => {
  const q = req.query.q || "";
  const suggestions = suggestCities(q, 10);
  res.json({
    ok: true,
    suggestions,
  });
});

// ===================== PLACES API для админки =====================

// Получить все места
app.get("/api/places", (req, res) => {
  const status = String(req.query.status || "approved").toLowerCase();

  let whereSql = "WHERE COALESCE(moderation_status, 'approved') = 'approved'";
  if (status === "all") {
    whereSql = "";
  } else if (status === "pending") {
    whereSql = "WHERE COALESCE(moderation_status, 'approved') = 'pending'";
  } else if (status === "rejected") {
    whereSql = "WHERE COALESCE(moderation_status, 'approved') = 'rejected'";
  }

  const sql = `SELECT * FROM places ${whereSql} ORDER BY id ASC`;

  db.all(sql, (err, rows) => {
    if (err) {
      console.error("DB error (get places):", err);
      return res.status(500).json({
        ok: false,
        message: "Ошибка сервера при получении мест",
      });
    }

    const places = (rows || [])
      .map(mapPlaceRow)
      .map((p) => enrichPlaceForClient(p, req));
  
    res.json({ ok: true, places });
  });
});

// Добавить место
app.post("/api/places", (req, res) => {
  const {
    name, type, city, address, image, images, badge, rating, reviews, features, link,
    hours, phone, 
  } = req.body;

  const nameValue = (name || "").trim();
  const cityValue = (city || "").trim();
  const addressValue = (address || "").trim();
  let imageValue = typeof image === "string" ? image.trim() : "";
  const imagesArr = Array.isArray(images) ? images.filter(Boolean) : [];

  if (!nameValue) {
    return res.json({
      ok: false,
      message: "Название обязательно",
    });
  }

  if (!cityValue) {
    return res.json({
      ok: false,
      message: "Город обязателен",
    });
  }

  if (!addressValue) {
    return res.json({
      ok: false,
      message: "Адрес обязателен",
    });
  }

  if (!imageValue && imagesArr.length === 0) {
    return res.json({
      ok: false,
      message: "Нужно добавить хотя бы одно фото",
    });
  }

  if (!imageValue && imagesArr.length) {
    imageValue = imagesArr[0];
  }

  const submittedByRaw = (req.body.submittedBy || "").trim();
  const submittedBy = submittedByRaw || null;
  const moderationStatus = submittedBy ? "pending" : "approved";
  const submittedAt = submittedBy ? Math.floor(Date.now() / 1000) : null;

  const featuresJson = JSON.stringify(Array.isArray(features) ? features : []);
  const imagesJson = JSON.stringify(imagesArr);

  const sql = `
    INSERT INTO places
      (name, type, city, address, image, images, badge, rating, reviews, features, link, hours, phone, moderation_status, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    sql,
    [
      nameValue,
      type || null,
      cityValue || null,
      addressValue || null,
      imageValue || null,
      imagesJson,
      badge || null,
      rating ?? null,
      reviews ?? null,
      featuresJson,
      link || null,
      hours || null,
      phone || null,
      moderationStatus,
      submittedBy,
      submittedAt,
    ],
    function (err) {
      if (err) {
        console.error("DB error (insert place):", err);
        return res.status(500).json({
          ok: false,
          message: "Ошибка сервера при добавлении места",
        });
      }

      const newId = this.lastID;
      db.get("SELECT * FROM places WHERE id = ?", [newId], (err2, row) => {
        if (err2 || !row) {
          return res.json({ ok: true }); // добавили, но не смогли вернуть
        }
        if (moderationStatus === "pending") {
          const lines = [
            "Новое место на модерации",
            `Название: ${row.name || ""}`,
            `Город: ${row.city || ""}`,
            `Адрес: ${row.address || ""}`,
            submittedBy ? `Отправил: ${submittedBy}` : "",
            `ID: ${row.id}`,
          ].filter(Boolean);
          void sendTelegramMessage(lines.join("\n"));
        }
        res.json({
          ok: true,
          place: mapPlaceRow(row),
        });
      });
    }
  );
});

// Обновить место
app.put("/api/places/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({
      ok: false,
      message: "Некорректный id",
    });
  }

  const {
    name, type, city, address, image, images, badge, rating, reviews, features, link,
    hours, phone, 
  } = req.body;

  if (!name || !name.trim()) {
    return res.json({
      ok: false,
      message: "Название обязательно",
    });
  }

  const featuresJson = JSON.stringify(Array.isArray(features) ? features : []);
  const imagesJson = JSON.stringify(Array.isArray(images) ? images : []);

  const sql = `
    UPDATE places
    SET
      name = ?,
      type = ?,
      city = ?,
      address = ?,
      image = ?,
      images = ?,
      badge = ?,
      rating = ?,
      reviews = ?,
      features = ?,
      link = ?,
      hours = ?,
      phone = ?
    WHERE id = ?
  `;

  db.run(
    sql,
    [
      name.trim(),
      type || null,
      city || null,
      address || null,
      image || null,
      imagesJson,
      badge || null,
      rating ?? null,
      reviews ?? null,
      featuresJson,
      link || null,
      hours || null,
      phone || null,
      id,
    ],
    function (err) {
      if (err) {
        console.error("DB error (update place):", err);
        return res.status(500).json({
          ok: false,
          message: "Ошибка сервера при обновлении места",
        });
      }

      if (this.changes === 0) {
        return res.json({
          ok: false,
          message: "Место не найдено",
        });
      }

      db.get("SELECT * FROM places WHERE id = ?", [id], (err2, row) => {
        if (err2 || !row) {
          return res.json({ ok: true });
        }
        const place = mapPlaceRow(row);
        res.json({
          ok: true,
          place: enrichPlaceForClient(place, req),
        });
      });
    }
  );
});

// Одобрить место (модерация)
app.post("/api/places/:id/approve", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, message: "Invalid id" });
  }

  db.run(
    "UPDATE places SET moderation_status = 'approved' WHERE id = ?",
    [id],
    function (err) {
      if (err) {
        console.error("DB error (approve place):", err);
        return res.status(500).json({ ok: false, message: "DB error" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ ok: false, message: "Place not found" });
      }
      return res.json({ ok: true });
    }
  );
});

// Отклонить место (модерация)
app.post("/api/places/:id/reject", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, message: "Invalid id" });
  }

  db.run(
    "UPDATE places SET moderation_status = 'rejected' WHERE id = ?",
    [id],
    function (err) {
      if (err) {
        console.error("DB error (reject place):", err);
        return res.status(500).json({ ok: false, message: "DB error" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ ok: false, message: "Place not found" });
      }
      return res.json({ ok: true });
    }
  );
});

// Удалить место
app.delete("/api/places/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({
      ok: false,
      message: "Некорректный id",
    });
  }

  db.run("DELETE FROM places WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("DB error (delete place):", err);
      return res.status(500).json({
        ok: false,
        message: "Ошибка сервера при удалении места",
      });
    }

    if (this.changes === 0) {
      return res.json({
        ok: false,
        message: "Место не найдено",
      });
    }

    res.json({ ok: true });
  });
});

// Фотографии места (по папке на диске, оставляем как есть)
app.get("/api/places/:id/photos", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, message: "Некорректный id" });
  }

  db.get("SELECT * FROM places WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error("DB error (place photos):", err);
      return res.status(500).json({ ok: false, message: "DB error" });
    }
    if (!row) {
      return res.status(404).json({ ok: false, message: "Место не найдено" });
    }

    const place = mapPlaceRow(row);
    const { photos, cover } = collectPlacePhotos(place, req);
    return res.json({ ok: true, photos, cover });
  });
});


// ===================== PLACE REVIEWS =====================
app.get("/api/places/:id/reviews", (req, res) => {
  const placeId = Number(req.params.id);
  if (!Number.isInteger(placeId)) {
    return res.status(400).json({ ok: false, message: "Invalid id" });
  }

  db.get("SELECT id FROM places WHERE id = ?", [placeId], (placeErr, placeRow) => {
    if (placeErr) {
      console.error("DB error (check place for reviews):", placeErr);
      return res.status(500).json({ ok: false, message: "DB error" });
    }

    if (!placeRow) {
      return res.status(404).json({ ok: false, message: "Place not found" });
    }

    const sql = `
      SELECT
        r.id,
        r.place_id,
        r.user_id,
        r.user_login,
        r.user_name,
        r.rating,
        r.text,
        r.images,
        r.created_at,
        COALESCE(u1.avatar, u2.avatar) AS user_avatar
      FROM place_reviews r
      LEFT JOIN users u1 ON u1.id = r.user_id
      LEFT JOIN users u2 ON (r.user_id IS NULL AND u2.login = r.user_login)
      WHERE r.place_id = ?
      ORDER BY r.created_at DESC, r.id DESC
    `;

    db.all(sql, [placeId], (err, rows) => {
      if (err) {
        console.error("DB error (get place reviews):", err);
        return res.status(500).json({ ok: false, message: "DB error" });
      }

      recalcPlaceRating(placeId, (recalcErr, stats) => {
        if (recalcErr) {
          console.error("DB error (recalc place rating):", recalcErr);
        }

        const reviews = (rows || []).map((r) => mapReviewRow(r, req));
        const count = stats?.total ?? reviews.length ?? 0;
        const average =
          stats?.average ??
          (reviews.length
            ? Math.round(
                (reviews.reduce((acc, r) => acc + Number(r.rating || 0), 0) /
                  reviews.length) *
                  10
              ) / 10
            : null);

        res.json({
          ok: true,
          reviews,
          stats: { count, average },
        });
      });
    });
  });
});

app.post("/api/places/:id/reviews", (req, res) => {
  const placeId = Number(req.params.id);
  if (!Number.isInteger(placeId)) {
    return res.status(400).json({ ok: false, message: "Invalid id" });
  }

  const { userLogin, text, rating, images } = req.body || {};
  const normalizedText = (text || "").trim();
  const ratingNumber = Number(rating);
  const imagesArray = Array.isArray(images)
    ? images
        .filter((item) => typeof item === "string" && item.trim())
        .slice(0, 10)
    : [];
  const imagesJson = JSON.stringify(imagesArray);

  if (!normalizedText) {
    return res
      .status(400)
      .json({ ok: false, message: "Review text is required" });
  }

  if (!Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5) {
    return res
      .status(400)
      .json({ ok: false, message: "Rating must be from 1 to 5" });
  }

  db.get("SELECT id, name FROM places WHERE id = ?", [placeId], (placeErr, placeRow) => {
    if (placeErr) {
      console.error("DB error (check place before insert review):", placeErr);
      return res.status(500).json({ ok: false, message: "DB error" });
    }

    if (!placeRow) {
      return res.status(404).json({ ok: false, message: "Place not found" });
    }

    resolveRequestUser(req, (requestErr, requester) => {
      if (requestErr) {
        console.error("DB error (resolve requester for review):", requestErr);
        return res.status(500).json({ ok: false, message: "DB error" });
      }

      const duplicateConditions = [];
      const duplicateParams = [placeId];

      if (requester.id) {
        duplicateConditions.push("user_id = ?");
        duplicateParams.push(requester.id);
      }

      if (requester.login) {
        duplicateConditions.push("user_login = ?");
        duplicateParams.push(requester.login);
      }

      const checkDuplicateAndContinue = (next) => {
        if (requester.isAdmin || !duplicateConditions.length) {
          return next(null, false);
        }

        const checkSql = `
          SELECT id
          FROM place_reviews
          WHERE place_id = ? AND (${duplicateConditions.join(" OR ")})
          LIMIT 1
        `;

        db.get(checkSql, duplicateParams, (dupErr, dupRow) => {
          if (dupErr) {
            console.error("DB error (check duplicate review):", dupErr);
            return next(dupErr);
          }

          return next(null, Boolean(dupRow));
        });
      };

      checkDuplicateAndContinue((dupErr, hasDuplicate) => {
        if (dupErr) {
          return res.status(500).json({ ok: false, message: "DB error" });
        }

        if (hasDuplicate) {
          return res.status(409).json({
            ok: false,
            message: "You already left a review for this place. Edit the existing one.",
          });
        }

        const resolveUserSql = requester.id
          ? "SELECT id, login, first_name, last_name, avatar FROM users WHERE id = ?"
          : "SELECT id, login, first_name, last_name, avatar FROM users WHERE login = ?";
        const resolveUserParam = requester.id || requester.login || null;

        if (!resolveUserParam) {
          return res.status(400).json({ ok: false, message: "User is required" });
        }

        db.get(resolveUserSql, [resolveUserParam], (userErr, userRow) => {
          if (userErr) {
            console.error("DB error (resolve user for review):", userErr);
            return res.status(500).json({ ok: false, message: "DB error" });
          }

          const finalUserId = userRow?.id ?? null;
          const finalUserLogin = userRow?.login ?? requester.login ?? (userLogin || null);

          const displayName = [userRow?.first_name, userRow?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim();

          const finalUserName = displayName || finalUserLogin || "Anonymous";

          const createdAt = Math.floor(Date.now() / 1000);
          const insertSql = `
            INSERT INTO place_reviews (place_id, user_id, user_login, user_name, rating, text, images, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `;

          db.run(
            insertSql,
            [placeId, finalUserId, finalUserLogin, finalUserName, ratingNumber, normalizedText, imagesJson, createdAt],
            function (err) {
              if (err) {
                if (err.code === "SQLITE_CONSTRAINT") {
                  return res.status(409).json({
                    ok: false,
                    message: "You already left a review for this place. Edit the existing one.",
                  });
                }

                console.error("DB error (insert review):", err);
                return res.status(500).json({ ok: false, message: "DB error" });
              }

              const newId = this.lastID;
              const fetchSql = `
                SELECT
                  r.id,
                  r.place_id,
                  r.user_id,
                  r.user_login,
                  r.user_name,
                  r.rating,
                  r.text,
                  r.images,
                  r.created_at,
                  COALESCE(u1.avatar, u2.avatar) AS user_avatar
                FROM place_reviews r
                LEFT JOIN users u1 ON u1.id = r.user_id
                LEFT JOIN users u2 ON (r.user_id IS NULL AND u2.login = r.user_login)
                WHERE r.id = ?
                LIMIT 1
              `;

              db.get(fetchSql, [newId], (getErr, row) => {
                if (getErr) {
                  console.error("DB error (fetch new review):", getErr);
                  return res.status(500).json({ ok: false, message: "DB error" });
                }

                recalcPlaceRating(placeId, (recalcErr, stats) => {
                  if (recalcErr) console.error("DB error (recalc after review insert):", recalcErr);

                  res.json({
                    ok: true,
                    review: row ? mapReviewRow(row, req) : null,
                    stats: stats || null,
                  });
                });
              });
            }
          );
        });
      });
    });

    return;
  });
});

app.put("/api/places/:placeId/reviews/:reviewId", (req, res) => {
  const placeId = Number(req.params.placeId);
  const reviewId = Number(req.params.reviewId);
  if (!Number.isInteger(placeId) || !Number.isInteger(reviewId)) {
    return res.status(400).json({ ok: false, message: "Invalid id" });
  }

  const { text, rating, images } = req.body || {};
  const updates = [];
  const params = [];

  if (typeof text === "string") {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return res.status(400).json({ ok: false, message: "Review text is required" });
    }
    updates.push("text = ?");
    params.push(normalizedText);
  }

  if (rating !== undefined) {
    const ratingNumber = Number(rating);
    if (!Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5) {
      return res.status(400).json({ ok: false, message: "Rating must be from 1 to 5" });
    }
    updates.push("rating = ?");
    params.push(ratingNumber);
  }

  if (images !== undefined) {
    const imagesArray = Array.isArray(images)
      ? images
          .filter((item) => typeof item === "string" && item.trim())
          .slice(0, 10)
      : [];
    updates.push("images = ?");
    params.push(JSON.stringify(imagesArray));
  }

  if (!updates.length) {
    return res.status(400).json({ ok: false, message: "Nothing to update" });
  }

  const sql = `
    UPDATE place_reviews
    SET ${updates.join(", ")}
    WHERE id = ? AND place_id = ?
  `;
  params.push(reviewId, placeId);

  resolveRequestUser(req, (userErr, requester) => {
    if (userErr) {
      console.error("DB error (resolve review user):", userErr);
      return res.status(500).json({ ok: false, message: "DB error" });
    }

    const reviewSql = `
      SELECT id, user_id, user_login
      FROM place_reviews
      WHERE id = ? AND place_id = ?
      LIMIT 1
    `;

    db.get(reviewSql, [reviewId, placeId], (reviewErr, reviewRow) => {
      if (reviewErr) {
        console.error("DB error (get review for update):", reviewErr);
        return res.status(500).json({ ok: false, message: "DB error" });
      }

      if (!reviewRow) {
        return res.status(404).json({ ok: false, message: "Review not found" });
      }

      const isOwner =
        (requester.id && reviewRow.user_id && requester.id === reviewRow.user_id) ||
        (requester.login && reviewRow.user_login && requester.login === reviewRow.user_login);

      if (!requester.isAdmin && !isOwner) {
        return res.status(403).json({ ok: false, message: "Not enough permissions" });
      }

      db.run(sql, params, function (err) {
        if (err) {
          console.error("DB error (update review):", err);
          return res.status(500).json({ ok: false, message: "DB error" });
        }

        if (this.changes === 0) {
          return res.status(404).json({ ok: false, message: "Review not found" });
        }

        const fetchSql = `
          SELECT
            r.id,
            r.place_id,
            r.user_id,
            r.user_login,
            r.user_name,
            r.rating,
            r.text,
            r.images,
            r.created_at,
            COALESCE(u1.avatar, u2.avatar) AS user_avatar
          FROM place_reviews r
          LEFT JOIN users u1 ON u1.id = r.user_id
          LEFT JOIN users u2 ON (r.user_id IS NULL AND u2.login = r.user_login)
          WHERE r.id = ? AND r.place_id = ?
          LIMIT 1
        `;

        db.get(fetchSql, [reviewId, placeId], (getErr, row) => {
          if (getErr) {
            console.error("DB error (fetch updated review):", getErr);
            return res.status(500).json({ ok: false, message: "DB error" });
          }

          recalcPlaceRating(placeId, (recalcErr, stats) => {
            if (recalcErr) console.error("DB error (recalc after review update):", recalcErr);
            return res.json({
              ok: true,
              review: row ? mapReviewRow(row, req) : null,
              stats: stats || null,
            });
          });
        });
      });
    });
  });
});

app.delete("/api/places/:placeId/reviews/:reviewId", (req, res) => {
  const placeId = Number(req.params.placeId);
  const reviewId = Number(req.params.reviewId);
  if (!Number.isInteger(placeId) || !Number.isInteger(reviewId)) {
    return res.status(400).json({ ok: false, message: "Invalid id" });
  }

  resolveRequestUser(req, (userErr, requester) => {
    if (userErr) {
      console.error("DB error (resolve review user):", userErr);
      return res.status(500).json({ ok: false, message: "DB error" });
    }

    const reviewSql = `
      SELECT id, user_id, user_login
      FROM place_reviews
      WHERE id = ? AND place_id = ?
      LIMIT 1
    `;

    db.get(reviewSql, [reviewId, placeId], (reviewErr, reviewRow) => {
      if (reviewErr) {
        console.error("DB error (get review for delete):", reviewErr);
        return res.status(500).json({ ok: false, message: "DB error" });
      }

      if (!reviewRow) {
        return res.status(404).json({ ok: false, message: "Review not found" });
      }

      const isOwner =
        (requester.id && reviewRow.user_id && requester.id === reviewRow.user_id) ||
        (requester.login && reviewRow.user_login && requester.login === reviewRow.user_login);

      if (!requester.isAdmin && !isOwner) {
        return res.status(403).json({ ok: false, message: "Not enough permissions" });
      }

      db.run(
        "DELETE FROM place_reviews WHERE id = ? AND place_id = ?",
        [reviewId, placeId],
        function (err) {
          if (err) {
            console.error("DB error (delete review):", err);
            return res.status(500).json({ ok: false, message: "DB error" });
          }

          if (this.changes === 0) {
            return res.status(404).json({ ok: false, message: "Review not found" });
          }

          recalcPlaceRating(placeId, (recalcErr, stats) => {
            if (recalcErr) console.error("DB error (recalc after review delete):", recalcErr);
            return res.json({
              ok: true,
              stats: stats || null,
            });
          });
        }
      );
    });
  });
});

// ===================== ARTICLES API =====================

// Публичный список статей (approved) + можно запросить draft/pending для профиля/админки
app.get("/api/articles", (req, res) => {
  const status = String(req.query.status || "approved").toLowerCase();
  const authorId = req.query.authorId ? Number(req.query.authorId) : null;
  const authorLogin = (req.query.authorLogin || "").trim();

  let where = "WHERE a.status = 'approved'";
  const params = [];

  if (status === "all") {
    where = "";
  } else if (["approved", "pending", "rejected", "draft"].includes(status)) {
    where = "WHERE a.status = ?";
    params.push(status);
  }

  if ((authorId && Number.isFinite(authorId)) || authorLogin) {
    where = where ? `${where} AND` : "WHERE";
    if (authorId && Number.isFinite(authorId)) {
      where += " a.author_id = ?";
      params.push(authorId);
    } else {
      where += " a.author_login = ?";
      params.push(authorLogin);
    }
  }

  const sql = `
    SELECT
      a.*,
      u.first_name AS author_first_name,
      u.last_name AS author_last_name,
      u.avatar AS author_avatar
    FROM articles a
    LEFT JOIN users u
      ON (u.id = a.author_id OR u.login = a.author_login)
    ${where}
    ORDER BY a.display_order DESC, a.published_at DESC, a.created_at DESC, a.id DESC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error("DB error (get articles):", err);
      return res.status(500).json({ ok: false, message: "DB error" });
    }

    const list = (rows || []).map((row) => {
      const a = mapArticleRow(row, req);
      return {
        ...a,
        coverImage: normalizeArticleMedia(a.coverImage),
      };
    });

    return res.json({ ok: true, articles: list });
  });
});

// Получить 1 статью
app.get("/api/articles/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  const sql = `
    SELECT
      a.*,
      u.first_name AS author_first_name,
      u.last_name AS author_last_name,
      u.avatar AS author_avatar
    FROM articles a
    LEFT JOIN users u
      ON (u.id = a.author_id OR u.login = a.author_login)
    WHERE a.id = ?
    LIMIT 1
  `;

  db.get(sql, [id], (err, row) => {
    if (err) {
      console.error("DB error (get article):", err);
      return res.status(500).json({ ok: false, message: "DB error" });
    }
    if (!row) return res.status(404).json({ ok: false, message: "Not found" });

    const article = mapArticleRow(row, req);
    article.coverImage = normalizeArticleMedia(article.coverImage);

    const status = article.status;
    if (status === "approved") return res.json({ ok: true, article });

    const userId = req.query.userId ? Number(req.query.userId) : null;
    const userLogin = (req.query.userLogin || "").trim();

    const isAdmin = userLogin === "admin";
    const isOwner =
      (userId && article.authorId && userId === article.authorId) ||
      (userLogin && article.authorLogin && userLogin === article.authorLogin);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({ ok: true, article });
  });
});

// Создать/обновить черновик или отправить на модерацию
// body: { title, coverImage, content, excerpt?, action: "draft"|"submit", userId, userLogin }
app.post("/api/articles", (req, res) => {
  const { title, coverImage, content, excerpt, action } = req.body || {};
  const titleValue = String(title || "").trim();
  const cover = normalizeArticleMedia(coverImage);

  let blocks = [];
  try {
    blocks = Array.isArray(content) ? content : JSON.parse(content || "[]");
  } catch {
    blocks = [];
  }

  resolveRequestUser(req, (uErr, requester) => {
    if (uErr) return res.status(500).json({ ok: false, message: "DB error" });
    if (!requester.login || requester.login === "admin") {
      return res.status(403).json({ ok: false, message: "Only authorized users can create articles" });
    }

    if (!titleValue) return res.json({ ok: false, message: "Заголовок обязателен" });

    // если submit — обложка обязательна
    if (String(action || "draft") === "submit" && !cover) {
      return res.json({ ok: false, code: "NO_COVER", message: "Нужна обложка" });
    }

    const status = String(action || "draft") === "submit" ? "pending" : "draft";
    const now = Math.floor(Date.now() / 1000);

    const sql = `
      INSERT INTO articles
        (title, cover_image, content_json, excerpt, status, author_id, author_login, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      sql,
      [
        titleValue,
        cover || "", // в draft можно пусто (но лучше сразу ставить)
        JSON.stringify(blocks || []),
        String(excerpt || "").slice(0, 280),
        status,
        requester.id ?? null,
        requester.login,
        status === "pending" ? now : null,
        now,
        now,
      ],
      function (err) {
        if (err) {
          console.error("DB error (insert article):", err);
          return res.status(500).json({ ok: false, message: "DB error" });
        }

        const newId = this.lastID;

        if (status === "pending") {
          const lines = [
            "Новая статья на модерации",
            `Заголовок: ${titleValue}`,
            `Автор: ${requester.login}`,
            `ID: ${newId}`,
          ];
          void sendTelegramMessage(lines.join("\n"));
        }

        return res.json({ ok: true, id: newId });
      }
    );
  });
});

// Редактировать статью (черновик/ожидание) — автор или админ
app.put("/api/articles/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  const { title, coverImage, content, excerpt, status, displayOrder } = req.body || {};

  let blocks = [];
  try {
    blocks = Array.isArray(content) ? content : JSON.parse(content || "[]");
  } catch {
    blocks = [];
  }

  const titleValue = String(title || "").trim();
  const cover = normalizeArticleMedia(coverImage);

  resolveRequestUser(req, (uErr, requester) => {
    if (uErr) return res.status(500).json({ ok: false, message: "DB error" });

    db.get("SELECT * FROM articles WHERE id = ? LIMIT 1", [id], (err, row) => {
      if (err) return res.status(500).json({ ok: false, message: "DB error" });
      if (!row) return res.status(404).json({ ok: false, message: "Not found" });

      const existing = mapArticleRow(row);
      const isAdmin = requester.login === "admin";
      const isOwner =
        (requester.id && existing.authorId && requester.id === existing.authorId) ||
        (requester.login && existing.authorLogin && requester.login === existing.authorLogin);

      if (!isAdmin && !isOwner) return res.status(403).json({ ok: false, message: "Forbidden" });

      // если админ — может менять status/order
      const nextStatus = isAdmin && status ? String(status) : existing.status;
      const nextOrder = isAdmin && displayOrder != null ? Number(displayOrder) : existing.displayOrder;

      // если переводим в approved — обложка обязательна
      const finalCover = cover || existing.coverImage || "";
      if (nextStatus === "approved" && !finalCover) {
        return res.json({ ok: false, code: "NO_COVER", message: "Нужна обложка" });
      }

      const now = Math.floor(Date.now() / 1000);
      const publishedAt = nextStatus === "approved" ? (existing.publishedAt || now) : existing.publishedAt;

      const updateSql = `
        UPDATE articles SET
          title = ?,
          cover_image = ?,
          content_json = ?,
          excerpt = ?,
          status = ?,
          display_order = ?,
          published_at = ?,
          updated_at = ?
        WHERE id = ?
      `;

      db.run(
        updateSql,
        [
          titleValue || existing.title,
          normalizeArticleMedia(finalCover),
          JSON.stringify(blocks || existing.content || []),
          String(excerpt || existing.excerpt || "").slice(0, 280),
          nextStatus,
          nextOrder,
          publishedAt,
          now,
          id,
        ],
        function (e2) {
          if (e2) {
            console.error("DB error (update article):", e2);
            return res.status(500).json({ ok: false, message: "DB error" });
          }
          return res.json({ ok: true });
        }
      );
    });
  });
});

// Модерация: approve/reject отдельными кнопками
app.post("/api/articles/:id/approve", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  resolveRequestUser(req, (uErr, requester) => {
    if (uErr) return res.status(500).json({ ok: false, message: "DB error" });
    if (requester.login !== "admin") return res.status(403).json({ ok: false, message: "Forbidden" });

    const now = Math.floor(Date.now() / 1000);
    db.run(
      "UPDATE articles SET status='approved', published_at=COALESCE(published_at, ?), updated_at=? WHERE id=?",
      [now, now, id],
      function (err) {
        if (err) return res.status(500).json({ ok: false, message: "DB error" });
        if (!this.changes) return res.status(404).json({ ok: false, message: "Not found" });
        return res.json({ ok: true });
      }
    );
  });
});

app.post("/api/articles/:id/reject", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  resolveRequestUser(req, (uErr, requester) => {
    if (uErr) return res.status(500).json({ ok: false, message: "DB error" });
    if (requester.login !== "admin") return res.status(403).json({ ok: false, message: "Forbidden" });

    const now = Math.floor(Date.now() / 1000);
    db.run(
      "UPDATE articles SET status='rejected', updated_at=? WHERE id=?",
      [now, id],
      function (err) {
        if (err) return res.status(500).json({ ok: false, message: "DB error" });
        if (!this.changes) return res.status(404).json({ ok: false, message: "Not found" });
        return res.json({ ok: true });
      }
    );
  });
});

// ===================== ARTICLE COMMENTS =====================
app.get("/api/articles/:id/comments", (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isInteger(articleId)) {
    return res.status(400).json({ ok: false, message: "Invalid id" });
  }

  const sql = `
    SELECT
      c.*,
      COALESCE(u1.avatar, u2.avatar) AS user_avatar
    FROM article_comments c
    LEFT JOIN users u1 ON u1.id = c.user_id
    LEFT JOIN users u2 ON (c.user_id IS NULL AND u2.login = c.user_login)
    WHERE c.article_id = ?
    ORDER BY c.created_at DESC, c.id DESC
  `;

  db.all(sql, [articleId], (err, rows) => {
    if (err) {
      console.error("DB error (get article comments):", err);
      return res.status(500).json({ ok: false, message: "DB error" });
    }

    return res.json({
      ok: true,
      comments: (rows || []).map((r) => mapArticleCommentRow(r, req)),
    });
  });
});

app.post("/api/articles/:id/comments", (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isInteger(articleId)) return res.status(400).json({ ok: false, message: "Invalid id" });

  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ ok: false, message: "Text is required" });

  resolveRequestUser(req, (uErr, requester) => {
    if (uErr) return res.status(500).json({ ok: false, message: "DB error" });
    if (!requester.login || requester.login === "admin") {
      return res.status(403).json({ ok: false, message: "Only authorized users can comment" });
    }

    const createdAt = Math.floor(Date.now() / 1000);

    // подтянем имя пользователя как в reviews (упрощённо)
    db.get("SELECT first_name, last_name, login FROM users WHERE id = ?", [requester.id], (e1, urow) => {
      const displayName = [urow?.first_name, urow?.last_name].filter(Boolean).join(" ").trim();
      const userName = displayName || requester.login;

      db.run(
        `INSERT INTO article_comments (article_id, user_id, user_login, user_name, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [articleId, requester.id ?? null, requester.login, userName, text, createdAt],
        function (e2) {
          if (e2) return res.status(500).json({ ok: false, message: "DB error" });
          return res.json({ ok: true, id: this.lastID });
        }
      );
    });
  });
});

// ===================== ARTICLE FAVORITES =====================
// POST -> add, DELETE -> remove
app.post("/api/articles/:id/favorite", (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isInteger(articleId)) return res.status(400).json({ ok: false, message: "Invalid id" });

  resolveRequestUser(req, (uErr, requester) => {
    if (uErr) return res.status(500).json({ ok: false, message: "DB error" });
    if (!requester.login || requester.login === "admin") {
      return res.status(403).json({ ok: false, message: "Only authorized users can favorite" });
    }

    db.run(
      "INSERT OR IGNORE INTO article_favorites (article_id, user_id, user_login) VALUES (?, ?, ?)",
      [articleId, requester.id ?? null, requester.login],
      function (err) {
        if (err) return res.status(500).json({ ok: false, message: "DB error" });
        return res.json({ ok: true });
      }
    );
  });
});

// ✅ Удалить статью (админ или автор)
app.delete("/api/articles/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  resolveRequestUser(req, (uErr, requester) => {
    if (uErr) return res.status(500).json({ ok: false, message: "DB error" });

    db.get("SELECT id, status, author_id, author_login FROM articles WHERE id = ? LIMIT 1", [id], (e1, row) => {
      if (e1) return res.status(500).json({ ok: false, message: "DB error" });
      if (!row) return res.status(404).json({ ok: false, message: "Not found" });

      const isAdmin = requester.login === "admin";
      const isOwner =
        (requester.id && row.author_id && requester.id === row.author_id) ||
        (requester.login && row.author_login && requester.login === row.author_login);

      // ✅ автор может удалять хотя бы draft (и pending тоже можно оставить)
      if (!isAdmin && !(isOwner && (row.status === "draft" || row.status === "pending"))) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }

      // favorites не связаны FK — чистим руками
      db.run("DELETE FROM article_favorites WHERE article_id = ?", [id], () => {
        db.run("DELETE FROM article_comments WHERE article_id = ?", [id], () => {
          db.run("DELETE FROM articles WHERE id = ?", [id], function (e2) {
            if (e2) return res.status(500).json({ ok: false, message: "DB error" });
            return res.json({ ok: true });
          });
        });
      });
    });
  });
});

app.delete("/api/articles/:id/favorite", (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isInteger(articleId)) return res.status(400).json({ ok: false, message: "Invalid id" });

  resolveRequestUser(req, (uErr, requester) => {
    if (uErr) return res.status(500).json({ ok: false, message: "DB error" });
    if (!requester.login || requester.login === "admin") {
      return res.status(403).json({ ok: false, message: "Only authorized users can favorite" });
    }

    db.run(
      "DELETE FROM article_favorites WHERE article_id = ? AND (user_id = ? OR user_login = ?)",
      [articleId, requester.id ?? -1, requester.login],
      function (err) {
        if (err) return res.status(500).json({ ok: false, message: "DB error" });
        return res.json({ ok: true });
      }
    );
  });
});

// Сколько избранных у статьи
app.get("/api/articles/:id/favorite-count", (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isInteger(articleId)) return res.status(400).json({ ok: false, message: "Invalid id" });

  db.get(
    "SELECT COUNT(*) AS cnt FROM article_favorites WHERE article_id = ?",
    [articleId],
    (err, row) => {
      if (err) return res.status(500).json({ ok: false, message: "DB error" });
      return res.json({ ok: true, count: Number(row?.cnt ?? 0) });
    }
  );
});

// ===================== ANALYTICS API =====================

app.post("/api/analytics/event", (req, res) => {
  const {
    event,
    payload = {},
    path: pagePath = "",
    referrer = "",
    userAgent = "",
    ts,
    visitorId = null,
    sessionId = null,
  } = req.body || {};

  const eventName = String(event || "").trim();
  if (!eventName) {
    return res.status(400).json({ ok: false, message: "Event is required" });
  }

  const ip = getClientIp(req);
  const ua = normalizeUa(userAgent || req.headers["user-agent"] || "");
  const deviceType = detectDeviceType(ua);
  const source = detectSource(referrer);

  const safeVisitorId = visitorId ? String(visitorId).trim() : null;
  const safeSessionId = sessionId ? String(sessionId).trim() : null;

  // fallback ключи, если фронт их не прислал
  const visitorKey = safeVisitorId || `${ip}__${ua}`;
  const sessionKey =
    safeSessionId || `${visitorKey}__${new Date().toDateString()}`;

  let entityType = null;
  let entityId = null;
  let entityTitle = null;
  let durationSec = null;

  if (eventName === "place_card_click") {
    entityType = "place";
    entityId = payload?.placeId != null ? String(payload.placeId) : null;
    entityTitle = payload?.placeName ? String(payload.placeName) : null;
  } else if (eventName === "article_card_click") {
    entityType = "article";
    entityId = payload?.articleId != null ? String(payload.articleId) : null;
    entityTitle = payload?.articleTitle ? String(payload.articleTitle) : null;
  } else if (
    eventName === "tg_popup_shown" ||
    eventName === "tg_popup_closed" ||
    eventName === "tg_popup_subscribe_click"
  ) {
    entityType = "popup";
    entityId = "telegram_popup";
    entityTitle = "Telegram popup";
  } else if (eventName === "session_start" || eventName === "session_end") {
    entityType = "session";
    entityId = sessionKey;
    entityTitle = "Website session";
  }

  if (eventName === "session_end") {
    const rawDuration = Number(payload?.durationSec);
    if (Number.isFinite(rawDuration) && rawDuration >= 0) {
      durationSec = Math.round(rawDuration);
    }
  }

  const createdAt =
    Number.isFinite(Number(ts)) && Number(ts) > 0
      ? Math.floor(Number(ts) / 1000)
      : Math.floor(Date.now() / 1000);

  const sql = `
    INSERT INTO analytics_events (
      event_name,
      path,
      referrer,
      source,
      ip,
      user_agent,
      device_type,
      visitor_id,
      session_id,
      visitor_key,
      session_key,
      entity_type,
      entity_id,
      entity_title,
      payload_json,
      duration_sec,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    sql,
    [
      eventName,
      String(pagePath || "").slice(0, 300),
      String(referrer || "").slice(0, 500),
      source,
      String(ip || "").slice(0, 100),
      ua,
      deviceType,
      safeVisitorId,
      safeSessionId,
      String(visitorKey).slice(0, 700),
      String(sessionKey).slice(0, 700),
      entityType,
      entityId,
      entityTitle,
      safeJsonStringify(payload),
      durationSec,
      createdAt,
    ],
    function (err) {
      if (err) {
        console.error("DB error (insert analytics event):", err);
        return res.status(500).json({ ok: false, message: "DB error" });
      }
      return res.json({ ok: true, id: this.lastID });
    }
  );
});

app.get("/api/admin/stats/overview", (req, res) => {
  const sqlTodayVisitors = `
    SELECT COUNT(*) AS cnt
    FROM analytics_events
    WHERE event_name = 'session_start'
      AND date(created_at, 'unixepoch', 'localtime') = date('now', 'localtime')
  `;

  const sqlYesterdayVisitors = `
    SELECT COUNT(*) AS cnt
    FROM analytics_events
    WHERE event_name = 'session_start'
      AND date(created_at, 'unixepoch', 'localtime') = date('now', '-1 day', 'localtime')
  `;

  const sqlTodayUniqueVisitors = `
    SELECT COUNT(DISTINCT visitor_key) AS cnt
    FROM analytics_events
    WHERE event_name = 'session_start'
      AND date(created_at, 'unixepoch', 'localtime') = date('now', 'localtime')
  `;

  const sqlYesterdayUniqueVisitors = `
    SELECT COUNT(DISTINCT visitor_key) AS cnt
    FROM analytics_events
    WHERE event_name = 'session_start'
      AND date(created_at, 'unixepoch', 'localtime') = date('now', '-1 day', 'localtime')
  `;

  const sqlAvgSessionDuration = `
    SELECT AVG(duration_sec) AS avg_duration
    FROM analytics_events
    WHERE event_name = 'session_end'
      AND duration_sec IS NOT NULL
      AND duration_sec > 0
  `;

  const sqlAvgPagesPerSession = `
    SELECT AVG(page_count) AS avg_pages
    FROM (
      SELECT session_key, COUNT(DISTINCT path) AS page_count
      FROM analytics_events
      WHERE path IS NOT NULL AND TRIM(path) <> ''
      GROUP BY session_key
    ) t
  `;

  const sqlPopupShown = `
    SELECT COUNT(*) AS cnt
    FROM analytics_events
    WHERE event_name = 'tg_popup_shown'
  `;

  const sqlPopupSubscribe = `
    SELECT COUNT(*) AS cnt
    FROM analytics_events
    WHERE event_name = 'tg_popup_subscribe_click'
  `;

  const sqlTopPlaces = `
    SELECT
      COALESCE(entity_title, 'Без названия') AS name,
      entity_id AS id,
      COUNT(*) AS clicks
    FROM analytics_events
    WHERE event_name = 'place_card_click'
      AND entity_type = 'place'
    GROUP BY entity_id, entity_title
    ORDER BY clicks DESC, name ASC
    LIMIT 10
  `;

  const sqlTopArticles = `
    SELECT
      COALESCE(entity_title, 'Без названия') AS title,
      entity_id AS id,
      COUNT(*) AS clicks
    FROM analytics_events
    WHERE event_name = 'article_card_click'
      AND entity_type = 'article'
    GROUP BY entity_id, entity_title
    ORDER BY clicks DESC, title ASC
    LIMIT 10
  `;

  const sqlTopSources = `
    SELECT
      COALESCE(source, 'unknown') AS source,
      COUNT(*) AS visits
    FROM analytics_events
    WHERE event_name = 'session_start'
    GROUP BY source
    ORDER BY visits DESC, source ASC
    LIMIT 10
  `;

  const sqlDevices = `
    SELECT
      COALESCE(device_type, 'unknown') AS device,
      COUNT(*) AS count
    FROM analytics_events
    WHERE event_name = 'session_start'
    GROUP BY device_type
    ORDER BY count DESC, device ASC
  `;

  db.get(sqlTodayVisitors, (e1, todayVisitorsRow) => {
    if (e1) {
      console.error("Stats error (today visitors):", e1);
      return res.status(500).json({ ok: false, message: "DB error" });
    }

    db.get(sqlYesterdayVisitors, (e2, yesterdayVisitorsRow) => {
      if (e2) {
        console.error("Stats error (yesterday visitors):", e2);
        return res.status(500).json({ ok: false, message: "DB error" });
      }

      db.get(sqlTodayUniqueVisitors, (e3, todayUniqueVisitorsRow) => {
        if (e3) {
          console.error("Stats error (today unique visitors):", e3);
          return res.status(500).json({ ok: false, message: "DB error" });
        }

        db.get(sqlYesterdayUniqueVisitors, (e4, yesterdayUniqueVisitorsRow) => {
          if (e4) {
            console.error("Stats error (yesterday unique visitors):", e4);
            return res.status(500).json({ ok: false, message: "DB error" });
          }

          db.get(sqlAvgSessionDuration, (e5, avgDurationRow) => {
            if (e5) {
              console.error("Stats error (avg session duration):", e5);
              return res.status(500).json({ ok: false, message: "DB error" });
            }

            db.get(sqlAvgPagesPerSession, (e6, avgPagesRow) => {
              if (e6) {
                console.error("Stats error (avg pages per session):", e6);
                return res.status(500).json({ ok: false, message: "DB error" });
              }

              db.get(sqlPopupShown, (e7, popupShownRow) => {
                if (e7) {
                  console.error("Stats error (popup shown):", e7);
                  return res.status(500).json({ ok: false, message: "DB error" });
                }

                db.get(sqlPopupSubscribe, (e8, popupSubscribeRow) => {
                  if (e8) {
                    console.error("Stats error (popup subscribe):", e8);
                    return res.status(500).json({ ok: false, message: "DB error" });
                  }

                  db.all(sqlTopPlaces, (e9, topPlacesRows) => {
                    if (e9) {
                      console.error("Stats error (top places):", e9);
                      return res.status(500).json({ ok: false, message: "DB error" });
                    }

                    db.all(sqlTopArticles, (e10, topArticlesRows) => {
                      if (e10) {
                        console.error("Stats error (top articles):", e10);
                        return res.status(500).json({ ok: false, message: "DB error" });
                      }

                      db.all(sqlTopSources, (e11, topSourcesRows) => {
                        if (e11) {
                          console.error("Stats error (top sources):", e11);
                          return res.status(500).json({ ok: false, message: "DB error" });
                        }

                        db.all(sqlDevices, (e12, devicesRows) => {
                          if (e12) {
                            console.error("Stats error (devices):", e12);
                            return res.status(500).json({ ok: false, message: "DB error" });
                          }

                          const todayVisitors = Number(todayVisitorsRow?.cnt ?? 0);
                          const yesterdayVisitors = Number(yesterdayVisitorsRow?.cnt ?? 0);
                          const todayUniqueVisitors = Number(todayUniqueVisitorsRow?.cnt ?? 0);
                          const yesterdayUniqueVisitors = Number(yesterdayUniqueVisitorsRow?.cnt ?? 0);
                          const avgSessionDurationSec = Math.round(
                            Number(avgDurationRow?.avg_duration ?? 0)
                          );
                          const avgPagesPerSession = Number(
                            Number(avgPagesRow?.avg_pages ?? 0).toFixed(1)
                          );

                          const tgPopupShown = Number(popupShownRow?.cnt ?? 0);
                          const tgPopupSubscribeClicks = Number(popupSubscribeRow?.cnt ?? 0);

                          const conversion =
                            tgPopupShown > 0
                              ? ((tgPopupSubscribeClicks / tgPopupShown) * 100).toFixed(1) + "%"
                              : "0%";

                          return res.json({
                            ok: true,
                            stats: {
                              todayVisitors,
                              yesterdayVisitors,
                              todayUniqueVisitors,
                              yesterdayUniqueVisitors,
                              avgSessionDurationSec,
                              avgSessionDurationHuman: formatDurationHuman(avgSessionDurationSec),
                              avgPagesPerSession,
                              tgPopupShown,
                              tgPopupSubscribeClicks,
                              tgPopupConversion: conversion,
                              topPlaces: (topPlacesRows || []).map((row) => ({
                                id: row.id,
                                name: row.name,
                                clicks: Number(row.clicks || 0),
                              })),
                              topArticles: (topArticlesRows || []).map((row) => ({
                                id: row.id,
                                title: row.title,
                                clicks: Number(row.clicks || 0),
                              })),
                              topSources: (topSourcesRows || []).map((row) => ({
                                source: row.source,
                                visits: Number(row.visits || 0),
                              })),
                              devices: (devicesRows || []).map((row) => ({
                                device: row.device,
                                count: Number(row.count || 0),
                              })),
                            },
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

// ===================== SERVER START =====================

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
