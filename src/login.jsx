// login.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "/api" : "http://localhost:3001");

function LoginPage({ onLogin }) {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    login: "",
    password: "",
  });

  const [resultText, setResultText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    // при изменении очищаем старую ошибку
    setHasError(false);
    setResultText("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setResultText("");
    setHasError(false);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login: form.login,
          password: form.password,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        let loginName = form.login;

        // если бэкенд вернул данные пользователя — сохраняем их
        if (data.user) {
          const u = data.user;
          loginName = u.login || form.login;

          const userForStorage = {
            login: u.login,
            firstName: u.first_name,
            lastName: u.last_name,
            city: u.city,
            email: u.email,
            status: u.status,
          };

          try {
            localStorage.setItem("user", JSON.stringify(userForStorage));
          } catch (e) {
            console.error("Не удалось сохранить пользователя в localStorage:", e);
          }
        }

        // успешный вход
        if (onLogin) {
          onLogin();
        }

        // если это админ — в админку, иначе в профиль
        if (loginName === "admin") {
          navigate("/admin");
        } else {
          navigate("/profile");
        }
      } else {
        // неверный логин или пароль
        setHasError(true);
        setResultText(data.message || "Неверный логин или пароль.");
      }
    } catch (error) {
      console.error("Ошибка при входе:", error);
      setHasError(true);
      setResultText("Ошибка соединения с сервером.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="login-section">
      <div className="login-section__container">
        <div className="login-section__top">
          <h1 className="login-section__title">
            Войдите на сайт, чтобы принять участие в обсуждении
          </h1>
        </div>

        <div className="login-card">
          <h2 className="login-card__title">Войти</h2>

          {/* 🔴 Баннер ошибки — сразу под заголовком, над формой */}
          {hasError && resultText && (
            <div className="login-error-banner">
              {resultText}
            </div>
          )}

          <form className="login-form" onSubmit={handleSubmit}>
            <input
              type="text"
              className={`login-input ${hasError ? "login-input--error" : ""}`}
              placeholder="Логин"
              name="login"
              value={form.login}
              onChange={handleChange}
              required
            />

            <input
              type="password"
              className={`login-input ${hasError ? "login-input--error" : ""}`}
              placeholder="Пароль"
              name="password"
              value={form.password}
              onChange={handleChange}
              required
            />

            <button type="submit" className="login-submit" disabled={isLoading}>
              {isLoading ? "Проверяем..." : "Войти"}
            </button>
          </form>

          <button
            type="button"
            className="login-register"
            onClick={() => navigate("/register")}
          >
            Зарегистрироваться
          </button>
        </div>
      </div>
    </section>
  );
}

export default LoginPage;

