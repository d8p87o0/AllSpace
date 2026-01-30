import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import placesData from "./places.json";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "/api" : "http://localhost:3001");
const FAVORITES_PREFIX = "favoritePlaces_";
const getFavoritesKey = (login) => `${FAVORITES_PREFIX}${login}`;

// стабильный "случайный" цвет по строке (login/id)
function stringToColor(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 45%)`;
}

function getInitials(user) {
  const fn = (user?.firstName ?? user?.first_name ?? "").trim();
  const ln = (user?.lastName ?? user?.last_name ?? "").trim();
  const login = (user?.login ?? "").trim();

  const a = (fn[0] || login[0] || "?").toUpperCase();
  const b = (ln[0] || "").toUpperCase();
  return (a + b).slice(0, 2);
}

function StockAvatar({ user, size = 64 }) {
  const key = String(user?.id ?? user?.login ?? "user");
  const bg = stringToColor(key);
  const initials = getInitials(user);

  return (
    <div
      className="profile__avatar"
      style={{ width: size, height: size, background: bg }}
      aria-label="avatar"
    >
      {initials}
    </div>
  );
}

function norm(v) {
  return String(v ?? "").trim();
}

export function ProfilePage({ onLogout }) {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [favoritePlaces, setFavoritePlaces] = useState([]);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: "",
    lastName: "",
    city: "",
    status: "",
  });

  const initialEditRef = useRef(null);

  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const fullName = useMemo(() => {
    if (!user) return "";
    const fn = user.firstName ?? user.first_name ?? "";
    const ln = user.lastName ?? user.last_name ?? "";
    return `${fn} ${ln}`.trim();
  }, [user]);

  useEffect(() => {
    let currentUser = null;

    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        currentUser = JSON.parse(raw);
        setUser(currentUser);
      }
    } catch (e) {
      console.error("Не удалось прочитать user из localStorage:", e);
    }

    if (!currentUser?.login) return;

    // если нет id в localStorage — подтянем с сервера
    const ensureUserId = async () => {
      if (currentUser?.id) return;
      try {
        const res = await fetch(`${API_BASE}/api/users/by-login/${encodeURIComponent(currentUser.login)}`);
        const data = await res.json();
        if (data.ok && data.user?.id) {
          const merged = { ...currentUser, ...data.user };
          setUser(merged);
          localStorage.setItem("user", JSON.stringify(merged));
        }
      } catch (e) {
        console.error("Не удалось получить user id:", e);
      }
    };

    ensureUserId();

    const favoritesKey = getFavoritesKey(currentUser.login);

    const loadFavorites = async () => {
      try {
        const rawFav = localStorage.getItem(favoritesKey);
        const ids = rawFav ? JSON.parse(rawFav) : [];
        const normalizedIds = Array.isArray(ids) ? ids.map(Number) : [];

        let places = [];
        try {
          const res = await fetch(`${API_BASE}/api/places`);
          const data = await res.json();
          if (data.ok) places = data.places || [];
        } catch (e) {
          console.error("Ошибка запроса /api/places:", e);
        }

        if (!places.length && (placesData || []).length) places = placesData;

        const favPlaces = places.filter((p) => normalizedIds.includes(Number(p.id)));
        setFavoritePlaces(favPlaces);
      } catch (e) {
        console.error("Не удалось прочитать избранное:", e);
      }
    };

    loadFavorites();
  }, []);

  const handleLogout = () => {
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        const u = JSON.parse(raw);
        if (u?.login) localStorage.removeItem(getFavoritesKey(u.login));
      }

      localStorage.removeItem("favoritePlaces");
      localStorage.removeItem("user");
    } catch (e) {
      console.error("Не удалось очистить localStorage при выходе:", e);
    }

    if (typeof onLogout === "function") onLogout();
    navigate("/login");
  };

  const openEdit = () => {
    if (!user) return;

    const snapshot = {
      firstName: (user.firstName ?? user.first_name ?? "") || "",
      lastName: (user.lastName ?? user.last_name ?? "") || "",
      city: user.city || "",
      status: user.status || "",
    };

    setEditForm(snapshot);
    initialEditRef.current = snapshot;

    setAvatarFile(null);
    setAvatarPreview(null);

    setIsEditing(true);
  };

  const closeEdit = () => {
    setIsEditing(false);
    setConfirmOpen(false);
    setAvatarFile(null);
    setAvatarPreview(null);
    initialEditRef.current = null;
  };

  const onEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const onPickAvatar = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    e.target.value = "";
  };

  const isDirty = useMemo(() => {
    if (!isEditing) return false;
    const init = initialEditRef.current;
    if (!init) return false;

    const changedText =
      norm(editForm.firstName) !== norm(init.firstName) ||
      norm(editForm.lastName) !== norm(init.lastName) ||
      norm(editForm.city) !== norm(init.city) ||
      norm(editForm.status) !== norm(init.status);

    const changedAvatar = !!avatarFile;

    return changedText || changedAvatar;
  }, [isEditing, editForm, avatarFile]);

  const onEditButtonClick = () => {
    if (!isEditing) {
      openEdit();
      return;
    }

    // повторное нажатие в режиме редактирования
    if (!isDirty) {
      closeEdit();
      return;
    }

    setConfirmOpen(true);
  };

  const saveProfile = async () => {
    if (!user?.id) {
      alert("Не найден id пользователя. Перезайди в аккаунт.");
      return;
    }

    try {
      // 1) если выбрали аватар — грузим файл
      let newAvatar = user.avatar || null;
      if (avatarFile) {
        const fd = new FormData();
        fd.append("avatar", avatarFile);

        const resA = await fetch(`${API_BASE}/api/users/${user.id}/avatar`, {
          method: "POST",
          body: fd,
        });
        const dataA = await resA.json();
        if (!dataA.ok) throw new Error(dataA.message || "Не удалось загрузить аватар");
        newAvatar = dataA.avatar || null;
      }

      // 2) сохраняем текстовые поля (email НЕ редактируем — отправляем текущий)
      const payload = {
        firstName: norm(editForm.firstName),
        lastName: norm(editForm.lastName),
        city: norm(editForm.city),
        status: norm(editForm.status),
        email: user.email || "", // просто чтобы сервер не затёр поле
      };

      const res = await fetch(`${API_BASE}/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Не удалось сохранить профиль");

      // 3) обновляем localStorage и state
      const updated = {
        ...user,
        ...data.user,
        // подстрахуем camelCase для UI:
        firstName: data.user?.first_name ?? payload.firstName,
        lastName: data.user?.last_name ?? payload.lastName,
        city: data.user?.city ?? payload.city,
        status: data.user?.status ?? payload.status,
        email: user.email, // держим email неизменным в UI
        avatar: newAvatar,
      };

      setUser(updated);
      localStorage.setItem("user", JSON.stringify(updated));
      closeEdit();
    } catch (e) {
      console.error(e);
      alert(e.message || "Ошибка сохранения профиля");
    }
  };

  const discardChanges = () => {
    setConfirmOpen(false);
    closeEdit();
  };

  const confirmSave = async () => {
    setConfirmOpen(false);
    await saveProfile();
  };

  if (!user) {
    return (
      <section className="profile">
        <div className="container profile__container">
          <div className="profile__card">
            <h1 className="profile__name">Профиль</h1>
            <p className="profile__empty-user">
              Вы не авторизованы.{" "}
              <button type="button" className="profile__link-button" onClick={() => navigate("/login")}>
                Войти
              </button>
            </p>
          </div>
        </div>
      </section>
    );
  }

  const showAvatarUrl = avatarPreview || user.avatar;

  return (
    <section className="profile">
      <div className="container profile__container">
        {/* Шапка профиля */}
        <div className="profile__card profile__header-card">
          <div className="profile__header-row">
            {/* Аватар */}
            <div className="profile__avatar-col">
              {showAvatarUrl ? (
                <img src={showAvatarUrl} alt="" className="profile__avatar-img" />
              ) : (
                <StockAvatar user={isEditing ? { ...user, ...editForm } : user} size={72} />
              )}

              {isEditing && (
                <>
                  <label className="profile__file-btn">
                    Загрузить аватар
                    <input type="file" accept="image/*" onChange={onPickAvatar} style={{ display: "none" }} />
                  </label>
                  <div className="profile__edit-hint">PNG/JPG/WebP до 5MB. Файл сохранится как id.png</div>
                </>
              )}
            </div>

            {/* Информация / редактирование на месте */}
            <div className="profile__info">
              <div className="profile__topline">
                {!isEditing ? (
                  <h1 className="profile__name">{fullName || user.login}</h1>
                ) : (
                  <div className="profile__name-fields">
                    <input
                      className="profile__edit-input profile__edit-input--white"
                      name="firstName"
                      value={editForm.firstName}
                      onChange={onEditChange}
                      placeholder="Имя"
                    />
                    <input
                      className="profile__edit-input profile__edit-input--white"
                      name="lastName"
                      value={editForm.lastName}
                      onChange={onEditChange}
                      placeholder="Фамилия"
                    />
                  </div>
                )}

                {/* Кнопка на уровне имени */}
                <button
                  type="button"
                  className="profile__edit-btn"
                  onClick={onEditButtonClick}
                >
                  Изменить
                </button>
              </div>

              {!isEditing ? (
                <>
                  <p className="profile__meta">
                    {user.status && <span className="profile__meta-item">{user.status}</span>}
                    {user.status && user.city && <span className="profile__meta-dot">•</span>}
                    {user.city && <span className="profile__meta-item">{user.city}</span>}
                  </p>

                  {user.email && <p className="profile__email">{user.email}</p>}
                </>
              ) : (
                <>
                  <div className="profile__edit-inline-grid">
                    <input
                      className="profile__edit-input profile__edit-input--white"
                      name="status"
                      value={editForm.status}
                      onChange={onEditChange}
                      placeholder="Статус (например: студент)"
                    />
                    <input
                      className="profile__edit-input profile__edit-input--white"
                      name="city"
                      value={editForm.city}
                      onChange={onEditChange}
                      placeholder="Город"
                    />
                  </div>

                  {/* Email НЕ редактируем */}
                  {user.email && (
                    <p className="profile__email profile__email--locked" title="Email нельзя редактировать">
                      {user.email} <span className="profile__lock">🔒</span>
                    </p>
                  )}

                  <div className="profile__edit-actions">
                    <button
                      type="button"
                      className="profile__btn profile__btn--primary"
                      onClick={saveProfile}
                      disabled={!isDirty}
                      title={!isDirty ? "Нет изменений для сохранения" : ""}
                    >
                      Сохранить
                    </button>

                    <button
                      type="button"
                      className="profile__btn"
                      onClick={() => (isDirty ? setConfirmOpen(true) : closeEdit())}
                    >
                      Отмена
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Поп-ап подтверждения */}
          {confirmOpen && (
            <div className="profile__confirm-overlay" role="dialog" aria-modal="true">
              <div className="profile__confirm-card">
                <div className="profile__confirm-title">Сохранить внесенные изменения?</div>
                <div className="profile__confirm-text">
                  Вы изменили данные профиля. Хотите сохранить их?
                </div>
                <div className="profile__confirm-actions">
                  <button type="button" className="profile__btn profile__btn--primary" onClick={confirmSave}>
                    Сохранить
                  </button>
                  <button type="button" className="profile__btn" onClick={discardChanges}>
                    Не сохранять
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Избранные места */}
        <div className="profile__favorites">
          <div className="profile__favorites-header">
            <h2 className="profile__favorites-title">Избранные места</h2>
            {favoritePlaces.length > 0 && <span className="profile__favorites-count">{favoritePlaces.length}</span>}
          </div>

          {favoritePlaces.length === 0 ? (
            <p className="profile__favorites-empty">
              У вас пока нет избранных мест. Перейдите в каталог и добавьте понравившиеся локации в избранное.
            </p>
          ) : (
            <div className="catalog__grid profile__favorites-grid">
              {favoritePlaces.map((place) => (
                <article key={place.id} className="place-card" onClick={() => navigate(`/place/${place.id}`)}>
                  <div className="place-card__image-wrapper">
                    <img src={place.image} alt={place.name} className="place-card__image" />
                    {place.badge && <span className="place-card__badge">{place.badge}</span>}
                  </div>

                  <div className="place-card__body">
                    <div className="place-card__header-row">
                      <div>
                        <h3 className="place-card__title">{place.name}</h3>
                        <p className="place-card__type">{place.type}</p>
                      </div>

                      <div className="place-card__rating">
                        <span className="place-card__rating-icon">★</span>
                        {typeof place.rating === "number" && (
                          <>
                            <span className="place-card__rating-value">{place.rating.toFixed(1)}</span>
                            <span className="place-card__rating-count">({place.reviews})</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="place-card__location">
                      <img src="/geo.svg" alt="" className="place-card__location-icon" />
                      <span className="place-card__location-text">{place.address}</span>
                    </div>

                    <div className="place-card__tags">
                      {(place.features || []).map((feature) => (
                        <span key={feature} className="place-card__tag">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="profile__logout-btn" onClick={handleLogout}>
          Выйти
        </button>
      </div>
    </section>
  );
}

export default ProfilePage;

