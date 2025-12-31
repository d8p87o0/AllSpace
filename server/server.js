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

dotenv.config();

const app = express();
const PORT = 3001;

const allowedOrigins = new Set([
  "http://localhost:5173",
  "https://allspace.com.ru",
  "https://www.allspace.com.ru",
]);

app.use(
  cors({
    origin(origin, cb) {
      // запросы без Origin (например healthcheck/cron)
      if (!origin) return cb(null, true);
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

const upload = multer({ storage });

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
  const host = `${req.protocol}://${req.get("host")}`;
  return fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => f.name)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map(
      (f) =>
        `${host}/photos/${encodeURIComponent(folder)}/${encodeURIComponent(f)}`
    );
}

function collectPlacePhotos(place, req) {
  const host = `${req.protocol}://${req.get("host")}`;

  // 1) Если у места явно задан список images в БД — доверяем ему и сохраняем порядок
  if (Array.isArray(place?.images) && place.images.length) {
    const photos = place.images
      .map((url) => {
        if (!url) return null;

        // уже абсолютный URL
        if (/^https?:\/\//i.test(url)) return url;

        // начинается с /photos/... — просто добавляем host
        if (url.startsWith("/photos/")) return `${host}${url}`;

        // начинается с /uploads или другой относительный путь
        if (url.startsWith("/")) return `${host}${url}`;

        // совсем голое имя файла / относительный путь — считаем от /photos
        return `${host}/photos/${url}`;
      })
      .filter(Boolean);

    const cover = photos[0] || place.image || null;
    return { photos, cover };
  }

  // 2) Легаси-режим: ищем папку по URL/названию и сканируем все файлы
  const firstImage = Array.isArray(place?.images) ? place.images[0] : null;
  const folder =
    extractFolderFromImage(place?.image || "") ||
    extractFolderFromImage(firstImage || "") ||
    findFolderByName(place?.name || "");
  const photos = listPhotos(folder, req);
  return { photos, cover: photos[0] || place?.image || null };
}

function enrichPlaceForClient(place, req) {
  const { photos, cover } = collectPlacePhotos(place, req);

  return {
    ...place,
    // cover = первая фотка (если нашлась), иначе то, что в БД
    image: cover || place.image || null,
    // если нашли фотки на диске — отдадим их как images
    images: Array.isArray(photos) && photos.length ? photos : (place.images || []),
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
      phone TEXT
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

  return {
    id: row.id,
    placeId: row.place_id,
    userId: row.user_id ?? null,
    userLogin: row.user_login || null,
    userName: row.user_name || null,
    userAvatar, // ✅ добавили
    rating: row.rating,
    text: row.text,
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
  db.all("SELECT * FROM places ORDER BY id ASC", (err, rows) => {
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

  if (!name || !name.trim()) {
    return res.json({
      ok: false,
      message: "Название обязательно",
    });
  }

  const featuresJson = JSON.stringify(Array.isArray(features) ? features : []);
  const imagesJson = JSON.stringify(Array.isArray(images) ? images : []);

  const sql = `
    INSERT INTO places
      (name, type, city, address, image, images, badge, rating, reviews, features, link, hours, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  const { userLogin, userId, text, rating } = req.body || {};
  const safeUserId = Number.isInteger(Number(userId)) ? Number(userId) : null;
  const normalizedText = (text || "").trim();
  const ratingNumber = Number(rating);

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
    
    // ✅ Подтянем актуальное имя/фамилию пользователя из users
    const resolveUserSql = safeUserId
      ? "SELECT id, login, first_name, last_name, avatar FROM users WHERE id = ?"
      : "SELECT id, login, first_name, last_name, avatar FROM users WHERE login = ?";

    const resolveUserParam = safeUserId ? safeUserId : (userLogin || null);

    db.get(resolveUserSql, [resolveUserParam], (userErr, userRow) => {
      if (userErr) {
        console.error("DB error (resolve user for review):", userErr);
        return res.status(500).json({ ok: false, message: "DB error" });
      }

      // если юзер не найден — оставим как аноним (или как пришёл login)
      const finalUserId = userRow?.id ?? null;
      const finalUserLogin = userRow?.login ?? (userLogin || null);

      const displayName = [userRow?.first_name, userRow?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();

      const finalUserName = displayName || finalUserLogin || "Аноним";

      const createdAt = Math.floor(Date.now() / 1000);
      const insertSql = `
        INSERT INTO place_reviews (place_id, user_id, user_login, user_name, rating, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(
        insertSql,
        [placeId, finalUserId, finalUserLogin, finalUserName, ratingNumber, normalizedText, createdAt],
        function (err) {
          if (err) {
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
                review: row ? mapReviewRow(row, req) : null, // ✅ avatar вернётся сразу
                stats: stats || null,
              });
            });
          });
        }
      );
    });

    return; // важно: чтобы код ниже не продолжал выполняться
  });
});

// ===================== СТАРТ СЕРВЕРА =====================

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
