// ProfilePage.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import placesData from "./places.json";
import "./App.css";

const FAVORITES_KEY = "favoritePlaces"; // массив id мест в localStorage

export function ProfilePage({ onLogout }) {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [favoritePlaces, setFavoritePlaces] = useState([]);

  useEffect(() => {
    // грузим пользователя
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        setUser(JSON.parse(raw));
      }
    } catch (e) {
      console.error("Не удалось прочитать user из localStorage:", e);
    }

    // грузим избранное
    try {
      const rawFav = localStorage.getItem(FAVORITES_KEY);
      const ids = rawFav ? JSON.parse(rawFav) : [];
      const normalizedIds = Array.isArray(ids) ? ids.map(String) : [];

      const favPlaces = (placesData || []).filter((p) =>
        normalizedIds.includes(String(p.id))
      );

      setFavoritePlaces(favPlaces);
    } catch (e) {
      console.error("Не удалось прочитать избранное:", e);
    }
  }, []);

  const handleLogout = () => {
    // чистим localStorage
    try {
      localStorage.removeItem("user");
      localStorage.removeItem(FAVORITES_KEY);
    } catch (e) {
      console.error("Не удалось очистить localStorage при выходе:", e);
    }

    // сбрасываем флаг авторизации в App.jsx
    if (typeof onLogout === "function") {
      onLogout();
    }

    // отправляем на страницу логина
    navigate("/login");
  };

  // если юзер не найден — просим залогиниться
  if (!user) {
    return (
      <section className="profile">
        <div className="container profile__container">
          <div className="profile__card">
            <h1 className="profile__name">Профиль</h1>
            <p className="profile__empty-user">
              Вы не авторизованы.{" "}
              <button
                type="button"
                className="profile__link-button"
                onClick={() => navigate("/login")}
              >
                Войти
              </button>
            </p>
          </div>
        </div>
      </section>
    );
  }

  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();

  return (
    <section className="profile">
      <div className="container profile__container">
        {/* Шапка профиля */}
        <div className="profile__card">
          <div className="profile__info">
            <h1 className="profile__name">{fullName || user.login}</h1>

            <p className="profile__meta">
              {user.status && (
                <span className="profile__meta-item">{user.status}</span>
              )}
              {user.status && user.city && (
                <span className="profile__meta-dot">•</span>
              )}
              {user.city && (
                <span className="profile__meta-item">{user.city}</span>
              )}
            </p>

            {user.email && (
              <p className="profile__email">{user.email}</p>
            )}
          </div>
        </div>

        {/* Избранные места */}
        <div className="profile__favorites">
          <div className="profile__favorites-header">
            <h2 className="profile__favorites-title">Избранные места</h2>
            {favoritePlaces.length > 0 && (
              <span className="profile__favorites-count">
                {favoritePlaces.length}
              </span>
            )}
          </div>

          {favoritePlaces.length === 0 ? (
            <p className="profile__favorites-empty">
              У вас пока нет избранных мест. Перейдите в каталог и добавьте
              понравившиеся локации в избранное.
            </p>
          ) : (
            <div className="catalog__grid profile__favorites-grid">
              {favoritePlaces.map((place) => (
                <article
                  key={place.id}
                  className="place-card"
                  onClick={() => navigate(`/place/${place.id}`)}
                >
                  <div className="place-card__image-wrapper">
                    <img
                      src={place.image}
                      alt={place.name}
                      className="place-card__image"
                    />
                    {place.badge && (
                      <span className="place-card__badge">
                        {place.badge}
                      </span>
                    )}
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
                            <span className="place-card__rating-value">
                              {place.rating.toFixed(1)}
                            </span>
                            <span className="place-card__rating-count">
                              ({place.reviews})
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="place-card__location">
                      <img
                        src="/geo.svg"
                        alt=""
                        className="place-card__location-icon"
                      />
                      <span className="place-card__location-text">
                        {place.address}
                      </span>
                    </div>

                    <div className="place-card__tags">
                      {(place.features || []).map((feature) => (
                        <span
                          key={feature}
                          className="place-card__tag"
                        >
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

        {/* 🔴 Кнопка выхода в самом низу */}
        <button
          type="button"
          className="profile__logout-btn"
          onClick={handleLogout}
        >
          Выйти
        </button>
      </div>
    </section>
  );
}

export default ProfilePage;