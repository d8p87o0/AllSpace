// VerifyEmailPage.jsx
import { useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "/api" : "http://localhost:3001");

function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const email = location.state?.email;

  const [code, setCode] = useState("");
  const [resultText, setResultText] = useState("");
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  if (!email) {
    return (
      <section className="login-section">
        <div className="login-section__container">
          <div className="login-card">
            <h2 className="login-card__title">Подтверждение почты</h2>
            <p>Нет данных о почте. Вернитесь к форме регистрации.</p>
            <button className="login-submit" onClick={() => navigate("/register")}>
              Назад к регистрации
            </button>
          </div>
        </div>
      </section>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();

    setHasError(false);
    setResultText("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/register/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, code }),
      });

      const data = await response.json();

      if (data.ok) {
        navigate("/login");
      } else {
        setHasError(true);
        setResultText(data.message || "Неверный код");
      }
    } catch (err) {
      console.error("Ошибка проверки кода:", err);
      setHasError(true);
      setResultText("Ошибка соединения с сервером.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="login-section">
      <div className="login-section__container">
        <div className="login-card">
          <h2 className="login-card__title">Подтвердите почту</h2>
          <p className="login-subtitle">
            Мы отправили шестизначный код на <b>{email}</b>. Введите его ниже.
          </p>

          {hasError && resultText && (
            <div className="login-error-banner">{resultText}</div>
          )}

          <form className="login-form" onSubmit={handleSubmit}>
            <input
              type="text"
              className="login-input"
              placeholder="Код из письма"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              required
            />

            <button
              type="submit"
              className="login-submit"
              disabled={isLoading || code.length !== 6}
            >
              {isLoading ? "Проверяем..." : "Подтвердить"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

export default VerifyEmailPage;

