import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";

function RegisterPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    city: "",
    phone: "",
    status: "",
  });

  const [agree, setAgree] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!agree) {
      // можно показать alert, если хочешь
      // alert("Нужно дать согласие на обработку персональных данных");
      return;
    }

    // тут потом будет реальный запрос на бэк
    console.log("Регистрация:", form);

    // после регистрации отправляем на главную (или куда тебе нужно)
    navigate("/");
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

            <input
              type="text"
              className="login-input"
              placeholder="Город"
              name="city"
              value={form.city}
              onChange={handleChange}
              required
            />

            <input
              type="tel"
              className="login-input"
              placeholder="Номер телефона"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              required
            />

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
              disabled={!agree}
            >
              Зарегистрироваться
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

export default RegisterPage;