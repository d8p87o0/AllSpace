// login.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";

function LoginPage({ onLogin }) {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    login: "",
    password: "",
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    // тут потом будет реальный запрос на бэк
    console.log("Вход:", form);

    if (onLogin) {
      onLogin();
    }

    // после логина отправляем на главную (или куда тебе нужно)
    navigate("/");
  };

  return (
    <section className="login-section">
      <div className="login-section__container">
        <div className="login-section__top">
          <h1 className="login-section__title">
            Войдите на сайт, чтобы принять участие в обсуждении
          </h1>

          <button
            type="button"
            className="login-close-btn"
            onClick={() => navigate(-1)}
            aria-label="Закрыть страницу входа"
          >
            ✕
          </button>
        </div>

        <div className="login-card">
          <h2 className="login-card__title">Войти</h2>

          <form className="login-form" onSubmit={handleSubmit}>
            <input
              type="text"
              className="login-input"
              placeholder="Логин"
              name="login"
              value={form.login}
              onChange={handleChange}
              required
            />

            <input
              type="password"
              className="login-input"
              placeholder="Пароль"
              name="password"
              value={form.password}
              onChange={handleChange}
              required
            />

            <button type="submit" className="login-submit">
              Войти
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