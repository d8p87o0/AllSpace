// server/server.js
import express from "express";
import cors from "cors";
import db from "./db.js";
import { suggestCities, cityExists } from "./cities.js"; // ← НОВОЕ

const app = express();
const PORT = 3001;

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);
app.use(express.json());

// === УЖЕ БЫЛО: логин ===
app.post("/api/login", (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({
      ok: false,
      message: "Логин и пароль обязательны",
    });
  }

  const sql = "SELECT * FROM users WHERE login = ? AND password = ?";

  db.get(sql, [login, password], (err, row) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({
        ok: false,
        message: "Ошибка сервера",
      });
    }

    if (row) {
      return res.json({
        ok: true,
        message: "ок",
      });
    } else {
      return res.json({
        ok: false,
        message: "нет",
      });
    }
  });
});

// === НОВОЕ: регистрация ===
app.post("/api/register", (req, res) => {
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

  // 🔎 Проверяем город по справочнику
  if (!cityExists(city)) {
    return res.json({
      ok: false,
      message: "Город не найден в справочнике",
    });
  }

  // Проверяем, что логин ещё не занят
  db.get(
    "SELECT id FROM users WHERE login = ?",
    [login],
    (err, row) => {
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

      // Вставляем нового пользователя
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
            console.error("DB error (insert user):", insertErr);
            return res.status(500).json({
              ok: false,
              message: "Ошибка сервера при регистрации",
            });
          }

          return res.json({
            ok: true,
            message: "ок",
          });
        }
      );
    }
  );
});

// GET /api/cities?q=мос
app.get("/api/cities", (req, res) => {
  const q = req.query.q || "";
  const suggestions = suggestCities(q, 10);
  res.json({
    ok: true,
    suggestions,
  });
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
