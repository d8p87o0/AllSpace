// RegisterPage.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "/api" : "http://localhost:3001");

function RegisterPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    city: "",
    phone: "", // почта
    status: "",
    login: "",
    passwordVisible: "",
    passwordHidden: "",
  });

  const [agree, setAgree] = useState(false);
  const [resultText, setResultText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  // 🔎 подсказки по городу
  const [citySuggestions, setCitySuggestions] = useState([]);

  // 🔐 ошибки и валидность формы
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [formValid, setFormValid] = useState(false);

  // 👁‍🗨 флаг "пользователь уже ушёл с поля почты"
  const [emailDirty, setEmailDirty] = useState(false);

  useEffect(() => {
    if (emailError || passwordError) {
      setFormValid(false);
    } else {
      setFormValid(true);
    }
  }, [emailError, passwordError]);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setHasError(false);
    setResultText("");

    // если меняется именно поле города — дергаем подсказки
    if (name === "city") {
      const trimmed = value.trim();

      if (trimmed.length < 2) {
        setCitySuggestions([]);
        return;
      }

      fetch(`${API_BASE}/api/cities?q=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && Array.isArray(data.suggestions)) {
            setCitySuggestions(data.suggestions);
          } else {
            setCitySuggestions([]);
          }
        })
        .catch((err) => {
          console.error("Ошибка загрузки городов:", err);
          setCitySuggestions([]);
        });
    }
  };

  // выбор города из подсказки
  const handleCitySelect = (cityName) => {
    setForm((prev) => ({
      ...prev,
      city: cityName,
    }));
    setCitySuggestions([]);
  };

  // ✅ валидация почты
  const emailHandler = (e) => {
    const value = e.target.value;

    setForm((prev) => ({
      ...prev,
      phone: value,
    }));

    setHasError(false);
    setResultText("");

    const re =
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

    if (!re.test(String(value).toLowerCase())) {
      setEmailError("Некорректный емейл");
    } else {
      setEmailError("");
    }
  };

  // blur по полю почты
  const handleBlur = (e) => {
    if (e.target.name === "phone") {
      setEmailDirty(true);
    }
  };

  // ✅ валидация пароля (первое поле)
  const passwordHandler = (e) => {
    const value = e.target.value;

    setForm((prev) => ({
      ...prev,
      passwordVisible: value,
    }));

    setHasError(false);
    setResultText("");

    if (!value) {
      setPasswordError("Пароль не может быть пустым");
    } else {
      setPasswordError("");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!agree) {
      return;
    }

    setResultText("");
    setHasError(false);

    // валидация фронта
    if (emailError || passwordError) {
      setHasError(true);
      setResultText("Пожалуйста, исправьте ошибки в форме.");
      return;
    }

    if (form.passwordVisible !== form.passwordHidden) {
      setHasError(true);
      setResultText("Пароли не совпадают.");
      return;
    }

    setIsLoading(true);

    try {
      // 🔥 ШАГ 1: отправляем данные для генерации и отправки кода
      const response = await fetch(`${API_BASE}/api/register/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login: form.login,
          password: form.passwordHidden,
          firstName: form.firstName,
          lastName: form.lastName,
          city: form.city,
          email: form.phone, // почта
          status: form.status,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        // переходим на страницу ввода кода
        navigate("/verify-email", { state: { email: form.phone } });
      } else {
        setHasError(true);
        setResultText(data.message || "Ошибка отправки кода.");
      }
    } catch (error) {
      console.error("Ошибка регистрации (start):", error);
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
            Зарегистрируйтесь, чтобы принимать участие в обсуждении
          </h1>

          <button
            type="button"
            className="login-close-btn"
            onClick={() => navigate(-1)}
            aria-label="Закрыть регистрацию"
          >
            ✕
          </button>
        </div>

        <div className="login-card">
          <h2 className="login-card__title">Регистрация</h2>

          {hasError && resultText && (
            <div className="login-error-banner">{resultText}</div>
          )}

          <form className="login-form" onSubmit={handleSubmit}>
            <input
              type="text"
              className="login-input"
              placeholder="Имя"
              name="firstName"
              value={form.firstName}
              onChange={handleChange}
              required
            />

            <input
              type="text"
              className="login-input"
              placeholder="Фамилия"
              name="lastName"
              value={form.lastName}
              onChange={handleChange}
              required
            />

            {/* Город + подсказки */}
            <div className="login-input-wrapper">
              <input
                type="text"
                className={`login-input ${
                  hasError ? "login-input--error" : ""
                }`}
                placeholder="Город"
                name="city"
                value={form.city}
                onChange={handleChange}
                required
              />

              {citySuggestions.length > 0 && (
                <div className="city-suggestions">
                  {citySuggestions.map((city) => (
                    <button
                      type="button"
                      key={city}
                      className="city-suggestions__item"
                      onClick={() => handleCitySelect(city)}
                    >
                      {city}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Почта с валидацией, сообщение только после blur */}
            <div className="login-input-wrapper">
              <input
                type="email"
                className={`login-input ${
                  emailDirty && emailError ? "login-input--error" : ""
                }`}
                placeholder="Почта"
                name="phone"
                value={form.phone}
                onChange={emailHandler}
                onBlur={handleBlur}
                required
              />
              {emailDirty && emailError && (
                <div className="login-input-error">{emailError}</div>
              )}
            </div>

            <select
              name="status"
              className="login-input"
              value={form.status}
              onChange={handleChange}
              required
            >
              <option value="" disabled>
                Выберите статус
              </option>
              <option value="дизайнер">Дизайнер</option>
              <option value="студент">Студент</option>
              <option value="программист">Программист</option>
              <option value="удаленщик">Удаленщик</option>
              <option value="другое">Другое</option>
            </select>

            <input
              type="text"
              className="login-input"
              placeholder="Логин"
              name="login"
              value={form.login}
              onChange={handleChange}
              required
            />

            {/* Пароль с валидацией – скрытый */}
            <div className="login-input-wrapper">
              <input
                type="password"
                className={`login-input ${
                  passwordError ? "login-input--error" : ""
                }`}
                placeholder="Придумайте пароль"
                name="passwordVisible"
                value={form.passwordVisible}
                onChange={passwordHandler}
                required
              />
              {passwordError && (
                <div className="login-input-error">{passwordError}</div>
              )}
            </div>

            <input
              type="password"
              className={`login-input ${
                hasError ? "login-input--error" : ""
              }`}
              placeholder="Повторите пароль"
              name="passwordHidden"
              value={form.passwordHidden}
              onChange={handleChange}
              required
            />

            <label className="register-consent">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
              />
              <span>
                Я согласен на обработку и хранение своих персональных данных
              </span>
            </label>

            <button
              type="submit"
              className="login-submit"
              disabled={!agree || isLoading || !formValid}
            >
              {isLoading ? "Отправляем..." : "Продолжить"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

export default RegisterPage;

