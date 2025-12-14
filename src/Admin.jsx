// src/Admin.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";

const API_BASE = "http://localhost:3001";

const emptyForm = {
  name: "",
  type: "",
  city: "",
  address: "",
  image: "",
  badge: "",
  rating: "",
  reviews: "",
  featuresText: "",
  link: "",
};

export default function AdminPage() {
  const navigate = useNavigate();

  const goToSite = () => {
    // полный перезапуск главной, как F5 на "/"
    window.location.href = "/";
  };


  const handleLogout = () => {
    try {
      localStorage.removeItem("user");
    } catch (e) {
      console.error("Ошибка очистки user из localStorage:", e);
    }
    // После логаута отправляем на страницу логина
    navigate("/login");
  };

  const [user, setUser] = useState(null);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null); // место для поп-апа удаления

  // проверяем, что это админ
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (!raw) {
        navigate("/login");
        return;
      }
      const u = JSON.parse(raw);
      setUser(u);

      if (u.login !== "admin") {
        navigate("/");
      }
    } catch (e) {
      console.error("Ошибка чтения user из localStorage:", e);
      navigate("/login");
    }
  }, [navigate]);

  const loadPlaces = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/places`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || "Не удалось загрузить места");
        setPlaces([]);
      } else {
        setPlaces(data.places || []);
      }
    } catch (e) {
      console.error("Ошибка загрузки мест:", e);
      setError("Ошибка соединения с сервером");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlaces();
  }, []);

  const handleSelectPlace = (place) => {
    setSelectedPlaceId(place.id);
    setEditForm({
      name: place.name || "",
      type: place.type || "",
      city: place.city || "",
      address: place.address || "",
      image: place.image || "",
      badge: place.badge || "",
      rating: place.rating != null ? String(place.rating) : "",
      reviews: place.reviews != null ? String(place.reviews) : "",
      featuresText: (place.features || []).join(", "),
      link: place.link || "",
    });
    setSuccess("");
    setError("");
  };

  const handleEditChange = (event) => {
    const { name, value } = event.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateChange = (event) => {
    const { name, value } = event.target;
    setCreateForm((prev) => ({ ...prev, [name]: value }));
  };

  const parseFeatures = (text) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!selectedPlaceId) return;

    setError("");
    setSuccess("");

    const body = {
      name: editForm.name.trim(),
      type: editForm.type.trim(),
      city: editForm.city.trim(),
      address: editForm.address.trim(),
      image: editForm.image.trim(),
      badge: editForm.badge.trim(),
      rating: editForm.rating ? Number(editForm.rating) : null,
      reviews: editForm.reviews ? Number(editForm.reviews) : null,
      features: parseFeatures(editForm.featuresText),
      link: editForm.link.trim(),
    };

    try {
      const res = await fetch(`${API_BASE}/api/places/${selectedPlaceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.message || "Не удалось сохранить изменения");
        return;
      }

      setSuccess("Изменения сохранены");
      await loadPlaces();

      if (data.place) {
        // обновим форму свежими данными
        handleSelectPlace(data.place);
      }
    } catch (e) {
      console.error("Ошибка обновления места:", e);
      setError("Ошибка соединения с сервером");
    }
  };

  const submitCreate = async (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    const body = {
      name: createForm.name.trim(),
      type: createForm.type.trim(),
      city: createForm.city.trim(),
      address: createForm.address.trim(),
      image: createForm.image.trim(),
      badge: createForm.badge.trim(),
      rating: createForm.rating ? Number(createForm.rating) : null,
      reviews: createForm.reviews ? Number(createForm.reviews) : null,
      features: parseFeatures(createForm.featuresText),
      link: createForm.link.trim(),
    };

    try {
      const res = await fetch(`${API_BASE}/api/places`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.message || "Не удалось добавить место");
        return;
      }

      setSuccess("Место добавлено");
      setCreateForm(emptyForm);
      await loadPlaces();
    } catch (e) {
      console.error("Ошибка добавления места:", e);
      setError("Ошибка соединения с сервером");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setError("");
    setSuccess("");

    try {
      const res = await fetch(`${API_BASE}/api/places/${deleteTarget.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.message || "Не удалось удалить место");
        return;
      }

      setSuccess(`Место "${deleteTarget.name}" удалено`);
      setDeleteTarget(null);
      if (selectedPlaceId === deleteTarget.id) {
        setSelectedPlaceId(null);
        setEditForm(emptyForm);
      }
      await loadPlaces();
    } catch (e) {
      console.error("Ошибка удаления места:", e);
      setError("Ошибка соединения с сервером");
    }
  };

  if (!user) {
    // пока проверяем юзера — ничего не рисуем
    return null;
  }

  return (
    <section className="admin">
      <div className="container admin__inner">
        <div className="admin__header">
          <div>
            <h1 className="admin__title">Админ-панель</h1>
            <p className="admin__subtitle">
              Управление местами для каталога
            </p>
          </div>

          <div className="admin__header-actions">
            <button
              type="button"
              className="admin__back-btn"
              onClick={() => navigate("/")}
            >
              На сайт
            </button>

            <button
              type="button"
              className="admin__logout-btn"
              onClick={handleLogout}
            >
              Выйти
            </button>
          </div>
        </div>

        {error && <div className="admin__alert admin__alert--error">{error}</div>}
        {success && (
          <div className="admin__alert admin__alert--success">{success}</div>
        )}

        <div className="admin__layout">
          {/* ЛЕВАЯ КОЛОНКА: список мест */}
          <aside className="admin__sidebar">
            <h2 className="admin__sidebar-title">Места</h2>

            {loading ? (
              <p className="admin__sidebar-empty">Загружаем...</p>
            ) : places.length === 0 ? (
              <p className="admin__sidebar-empty">
                В базе пока нет мест. Добавьте первое.
              </p>
            ) : (
              <div className="admin__places-list">
                {places.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    className={
                      "admin__place-btn" +
                      (place.id === selectedPlaceId
                        ? " admin__place-btn--active"
                        : "")
                    }
                    onClick={() => handleSelectPlace(place)}
                  >
                    <span className="admin__place-btn-name">{place.name}</span>
                    <span className="admin__place-btn-city">{place.city}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedPlaceId && (
              <button
                type="button"
                className="admin__delete-btn"
                onClick={() => {
                  const p = places.find((pl) => pl.id === selectedPlaceId);
                  if (p) setDeleteTarget(p);
                }}
              >
                Удалить выбранное место
              </button>
            )}
          </aside>

          {/* ПРАВАЯ КОЛОНКА: формы */}
          <div className="admin__content">
            {/* Форма редактирования */}
            <div className="admin__card">
              <h2 className="admin__card-title">Редактирование места</h2>
              {!selectedPlaceId ? (
                <p className="admin__hint">
                  Выберите место слева, чтобы отредактировать.
                </p>
              ) : (
                <form className="admin-form" onSubmit={submitEdit}>
                  <div className="admin-form__grid">
                    <input
                      type="text"
                      name="name"
                      className="admin-input"
                      placeholder="Название"
                      value={editForm.name}
                      onChange={handleEditChange}
                      required
                    />
                    <input
                      type="text"
                      name="type"
                      className="admin-input"
                      placeholder="Тип (кафе, коворкинг...)"
                      value={editForm.type}
                      onChange={handleEditChange}
                    />
                    <input
                      type="text"
                      name="city"
                      className="admin-input"
                      placeholder="Город"
                      value={editForm.city}
                      onChange={handleEditChange}
                    />
                    <input
                      type="text"
                      name="address"
                      className="admin-input"
                      placeholder="Адрес"
                      value={editForm.address}
                      onChange={handleEditChange}
                    />
                    <input
                      type="text"
                      name="image"
                      className="admin-input"
                      placeholder="Главная картинка (путь, например: /p1p1.png)"
                      value={editForm.image}
                      onChange={handleEditChange}
                    />
                    <input
                      type="text"
                      name="badge"
                      className="admin-input"
                      placeholder="Бейдж (например: Бесплатно, PP)"
                      value={editForm.badge}
                      onChange={handleEditChange}
                    />
                    <input
                      type="number"
                      step="0.1"
                      name="rating"
                      className="admin-input"
                      placeholder="Рейтинг (например: 4.5)"
                      value={editForm.rating}
                      onChange={handleEditChange}
                    />
                    <input
                      type="number"
                      name="reviews"
                      className="admin-input"
                      placeholder="Кол-во отзывов"
                      value={editForm.reviews}
                      onChange={handleEditChange}
                    />
                    <input
                      type="text"
                      name="link"
                      className="admin-input"
                      placeholder="Ссылка на Яндекс.Карты"
                      value={editForm.link}
                      onChange={handleEditChange}
                    />
                  </div>

                  <label className="admin-label">
                    Удобства (через запятую)
                    <textarea
                      name="featuresText"
                      className="admin-textarea"
                      placeholder="Wi-Fi, Розетки, Тихо, Коворкинг..."
                      value={editForm.featuresText}
                      onChange={handleEditChange}
                    />
                  </label>

                  <button type="submit" className="admin-submit">
                    Сохранить изменения
                  </button>
                </form>
              )}
            </div>

            {/* Форма добавления */}
            <div className="admin__card">
              <h2 className="admin__card-title">Добавить место</h2>

              <form className="admin-form" onSubmit={submitCreate}>
                <div className="admin-form__grid">
                  <input
                    type="text"
                    name="name"
                    className="admin-input"
                    placeholder="Название"
                    value={createForm.name}
                    onChange={handleCreateChange}
                    required
                  />
                  <input
                    type="text"
                    name="type"
                    className="admin-input"
                    placeholder="Тип (кафе, коворкинг...)"
                    value={createForm.type}
                    onChange={handleCreateChange}
                  />
                  <input
                    type="text"
                    name="city"
                    className="admin-input"
                    placeholder="Город"
                    value={createForm.city}
                    onChange={handleCreateChange}
                  />
                  <input
                    type="text"
                    name="address"
                    className="admin-input"
                    placeholder="Адрес"
                    value={createForm.address}
                    onChange={handleCreateChange}
                  />
                  <input
                    type="text"
                    name="image"
                    className="admin-input"
                    placeholder="Главная картинка (путь, например: /p1p1.png)"
                    value={createForm.image}
                    onChange={handleCreateChange}
                  />
                  <input
                    type="text"
                    name="badge"
                    className="admin-input"
                    placeholder="Бейдж (например: Бесплатно, PP)"
                    value={createForm.badge}
                    onChange={handleCreateChange}
                  />
                  <input
                    type="number"
                    step="0.1"
                    name="rating"
                    className="admin-input"
                    placeholder="Рейтинг (например: 4.5)"
                    value={createForm.rating}
                    onChange={handleCreateChange}
                  />
                  <input
                    type="number"
                    name="reviews"
                    className="admin-input"
                    placeholder="Кол-во отзывов"
                    value={createForm.reviews}
                    onChange={handleCreateChange}
                  />
                  <input
                    type="text"
                    name="link"
                    className="admin-input"
                    placeholder="Ссылка на Яндекс.Карты"
                    value={createForm.link}
                    onChange={handleCreateChange}
                  />
                </div>

                <label className="admin-label">
                  Удобства (через запятую)
                  <textarea
                    name="featuresText"
                    className="admin-textarea"
                    placeholder="Wi-Fi, Розетки, Тихо, Коворкинг..."
                    value={createForm.featuresText}
                    onChange={handleCreateChange}
                  />
                </label>

                <button type="submit" className="admin-submit">
                  Добавить место
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Поп-ап удаления */}
      {deleteTarget && (
        <div className="admin-modal" onClick={() => setDeleteTarget(null)}>
          <div
            className="admin-modal__content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="admin-modal__title">
              Удалить место &laquo;{deleteTarget.name}&raquo;?
            </h3>
            <p className="admin-modal__text">
              Это действие нельзя будет отменить.
            </p>

            <div className="admin-modal__actions">
              <button
                type="button"
                className="admin-modal__btn admin-modal__btn--danger"
                onClick={confirmDelete}
              >
                Удалить
              </button>
              <button
                type="button"
                className="admin-modal__btn"
                onClick={() => setDeleteTarget(null)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}