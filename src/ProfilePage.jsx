import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import placesData from "./places.json";
import "./App.css";

const API_BASE = "http://localhost:3001";
const FAVORITES_PREFIX = "favoritePlaces_";

const getFavoritesKey = (login) => `${FAVORITES_PREFIX}${login}`;

export function ProfilePage({ onLogout }) {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [favoritePlaces, setFavoritePlaces] = useState([]);

  useEffect(() => {
    let currentUser = null;

    // 1) грузим пользователя
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        currentUser = JSON.parse(raw);
        setUser(currentUser);
      }
    } catch (e) {
      console.error("Не удалось прочитать user из localStorage:", e);
    }

    if (!currentUser || !currentUser.login) {
      return;
    }

    const favoritesKey = getFavoritesKey(currentUser.login);

    // 2) грузим избранное + места
    const loadFavorites = async () => {
      try {
        const rawFav = localStorage.getItem(favoritesKey);
        const ids = rawFav ? JSON.parse(rawFav) : [];
        const normalizedIds = Array.isArray(ids) ? ids.map(Number) : [];

        // тянем места из API
        let places = [];
        try {
          const res = await fetch(`${API_BASE}/api/places`);
          const data = await res.json();
          if (data.ok) {
            places = data.places || [];
          } else {
            console.error("Не удалось загрузить места из API:", data.message);
          }
        } catch (e) {
          console.error("Ошибка запроса /api/places:", e);
        }

        // fallback: если API ничего не вернул, используем places.json
        if (!places.length && (placesData || []).length) {
          places = placesData;
        }

        const favPlaces = places.filter((p) =>
          normalizedIds.includes(Number(p.id))
        );

        setFavoritePlaces(favPlaces);
      } catch (e) {
        console.error("Не удалось прочитать избранное:", e);
      }
    };

    loadFavorites();
  }, []);

  const handleLogout = () => {
    try {
      // чистим избранное текущего пользователя
      const raw = localStorage.getItem("user");
      if (raw) {
        const u = JSON.parse(raw);
        if (u && u.login) {
          const key = getFavoritesKey(u.login);
          localStorage.removeItem(key);
        }
      }

      // на всякий случай чистим старый общий ключ
      localStorage.removeItem("favoritePlaces");
      localStorage.removeItem("user");
    } catch (e) {
      console.error("Не удалось очистить localStorage при выходе:", e);
    }

    if (typeof onLogout === "function") {
      onLogout();
    }

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