// server/server.js
import express from "express";
import cors from "cors";
import db from "./db.js";
import { suggestCities, cityExists } from "./cities.js";

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

// ===================== SMTP НАСТРОЙКА =====================
// НУЖНЫ переменные в .env:
// SMTP_HOST=smtp.вашейпочты.com
// SMTP_PORT=465 (или 587)
// SMTP_USER=your_email@example.com
// SMTP_PASS=пароль_приложения
// FROM_EMAIL=your_email@example.com (можно не указывать, тогда возьмется SMTP_USER)

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true, // true для 465; если используешь 587, можно secure: false + tls
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// временное хранилище незавершённых регистраций (для dev)
const pendingRegistrations = new Map();
// key: email
// value: { code, userData: {login, password, ...}, expiresAt }

// ===================== ЛОГИН (как было) =====================
// ===================== ЛОГИН (обновлённый) =====================
app.post("/api/login", (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({
      ok: false,
      message: "Логин и пароль обязательны",
    });
  }

  // забираем только нужные поля, пароль в ответ не отдаём
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

    // пользователь не найден
    if (!row) {
      return res.json({
        ok: false,
        message: "Неверный логин или пароль",
      });
    }

    // формируем объект user для фронта
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
// /api/register/start — проверяем данные, город, логин, генерим код, шлём на почту

app.post("/api/register/start", (req, res) => {
  const {
    login,
    password,
    firstName,
    lastName,
    city,
    email,
    status,
  } = req.body;

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

  // 🔎 Проверяем город по справочнику
  if (!cityExists(city)) {
    return res.json({
      ok: false,
      message: "Город не найден в справочнике",
    });
  }

  // Проверяем, что логин ещё не занят
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

    // логин свободен, город ок — генерим 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 минут

    const userData = {
      login,
      password,
      firstName,
      lastName,
      city,
      email,
      status,
    };

    // сохраняем в pendingRegistrations
    pendingRegistrations.set(email, {
      code,
      userData,
      expiresAt,
    });

    // отправляем письмо
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
// /api/register/verify — проверяем код, если ок — создаём пользователя в БД

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

  const {
    login,
    password,
    firstName,
    lastName,
    city,
    status,
  } = record.userData;

  // На всякий случай ещё раз проверим логин
  db.get("SELECT id FROM users WHERE login = ?", [login], (err, row) => {
    if (err) {
      console.error("DB error (check login on verify):", err);
      return res.status(500).json({
        ok: false,
        message: "Ошибка сервера",
      });
    }

    if (row) {
      // теоретически сюда попадём, если пока человек вводил код,
      // кто-то уже занял логин
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

        // удаляем запись из pendingRegistrations — регистрация завершена
        pendingRegistrations.delete(email);

        return res.json({
          ok: true,
          message: "ок",
        });
      }
    );
  });
});

// ===================== ПОДСКАЗКИ ГОРОДОВ (как было) =====================

app.get("/api/cities", (req, res) => {
  const q = req.query.q || "";
  const suggestions = suggestCities(q, 10);
  res.json({
    ok: true,
    suggestions,
  });
});

// ===================== СТАРТ СЕРВЕРА =====================

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});