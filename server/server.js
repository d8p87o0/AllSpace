// server/server.js
import express from "express";
import cors from "cors";
import db from "./db.js";
import { suggestCities, cityExists } from "./cities.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3001;






app.use(
  cors({
    origin: "http://localhost:5173",
  })
);
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Работа с фото
const photosRoot = path.join(__dirname, "photos");

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
  const folder =
    extractFolderFromImage(place?.image || "") ||
    findFolderByName(place?.name || "");
  const photos = listPhotos(folder, req);
  return { photos, cover: photos[0] || place?.image || null };
}

// ✅ статическая раздача фото
app.use("/photos", express.static(path.join(__dirname, "photos")));

// ===================== PLACES: таблица и начальное наполнение =====================

// создаём таблицу places, если её ещё нет
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
      features TEXT, -- JSON-строка с массивом фич
      link TEXT
    )
  `);

  // Путь к places.json (если структура проекта: /server/server.js и /src/places.json)
  const placesJsonPath = path.join(__dirname, "../src/places.json");

  // Один раз перенесём данные из places.json в БД, если таблица пустая
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
            (id, name, type, city, address, image, badge, rating, reviews, features, link)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const stmt = db.prepare(insertSql);

        for (const p of placesFromJson) {
          const featuresJson = JSON.stringify(p.features || []);
          stmt.run(
            p.id || null,
            p.name || "",
            p.type || null,
            p.city || null,
            p.address || null,
            p.image || null,
            p.badge || null,
            typeof p.rating === "number" ? p.rating : null,
            typeof p.reviews === "number" ? p.reviews : null,
            featuresJson,
            p.link || null
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

// хелпер для преобразования строки features в массив
function mapPlaceRow(row) {
  let features = [];
  try {
    features = row.features ? JSON.parse(row.features) : [];
  } catch (e) {
    features = [];
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    city: row.city,
    address: row.address,
    image: row.image,
    badge: row.badge,
    rating: row.rating,
    reviews: row.reviews,
    features,
    link: row.link,
  };
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
      login,
      first_name,
      last_name,
      city,
      email,
      status
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

    const user = {
      login: row.login,
      first_name: row.first_name,
      last_name: row.last_name,
      city: row.city,
      email: row.email,
      status: row.status,
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
  const { login, password, firstName, lastName, city, email, status } = req.body;

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

    const places = (rows || []).map(mapPlaceRow);
    res.json({ ok: true, places });
  });
});

// Добавить место
app.post("/api/places", (req, res) => {
  const { name, type, city, address, image, badge, rating, reviews, features, link } =
    req.body;

  if (!name || !name.trim()) {
    return res.json({
      ok: false,
      message: "Название обязательно",
    });
  }

  const featuresJson = JSON.stringify(Array.isArray(features) ? features : []);

  const sql = `
    INSERT INTO places
      (name, type, city, address, image, badge, rating, reviews, features, link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    sql,
    [
      name.trim(),
      (type || null),
      (city || null),
      (address || null),
      (image || null),
      (badge || null),
      rating ?? null,
      reviews ?? null,
      featuresJson,
      (link || null),
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

  const { name, type, city, address, image, badge, rating, reviews, features, link } =
    req.body;

  if (!name || !name.trim()) {
    return res.json({
      ok: false,
      message: "Название обязательно",
    });
  }

  const featuresJson = JSON.stringify(Array.isArray(features) ? features : []);

  const sql = `
    UPDATE places
    SET
      name = ?,
      type = ?,
      city = ?,
      address = ?,
      image = ?,
      badge = ?,
      rating = ?,
      reviews = ?,
      features = ?,
      link = ?
    WHERE id = ?
  `;

  db.run(
    sql,
    [
      name.trim(),
      (type || null),
      (city || null),
      (address || null),
      (image || null),
      (badge || null),
      rating ?? null,
      reviews ?? null,
      featuresJson,
      (link || null),
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
        res.json({
          ok: true,
          place: mapPlaceRow(row),
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

// Фотографии места
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

// ===================== СТАРТ СЕРВЕРА =====================

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
