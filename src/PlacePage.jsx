// src/PlacePage.jsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import reviewsData from "./reviews.json";
import usersData from "./users.json";

const API_BASE = "http://localhost:3001";

// Доп. описание и особенности для мест
const PLACE_DETAILS = {
  1: {
    description:
      "Уютное кафе в центре города с отличным кофе и комфортной атмосферой для работы. Просторный зал, много розеток, быстрый Wi-Fi. Идеально подходит для фрилансеров и удалённых сотрудников.",
    wifi: "100 Мбит/с, стабильное подключение",
    noise: "Тихо · 4.5/5",
    sockets: "Розетки у каждого столика",
    avgCheck: "300–500 ₽",
  },
  default: {
    description:
      "Уютное место для работы и встреч. Есть Wi-Fi, розетки и комфортная атмосфера.",
    wifi: "Быстрый Wi-Fi",
    noise: "Средний уровень шума",
    sockets: "Розетки в зале",
    avgCheck: "Средний чек 300–700 ₽",
  },
};

function getInitials(name) {
  if (!name) return "?";
  const parts = name.split(" ");
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";
  return (first + second).toUpperCase();
}

// Строим список картинок p1p1.png … p1p6.png по имени первой
function buildGalleryImages(src) {
  if (!src) return [];
  const dotIndex = src.lastIndexOf(".");
  if (dotIndex === -1) return [src];

  const ext = src.slice(dotIndex); // ".png"
  const name = src.slice(0, dotIndex); // "/p1p1"
  const lastChar = name.slice(-1);
  const base = /\d/.test(lastChar) ? name.slice(0, -1) : name;

  const images = [];
  for (let i = 1; i <= 6; i++) {
    images.push(`${base}${i}${ext}`);
  }
  return images;
}

export default function PlacePage() {
  const { id } = useParams();
  const placeId = Number(id);

  const [place, setPlace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);

  // сброс UI при смене id
  useEffect(() => {
    window.scrollTo(0, 0);
    setActiveIndex(0);
    setIsLightboxOpen(false);
    setIsFavorite(false);
  }, [placeId]);

  // грузим место из API
  useEffect(() => {
    let cancelled = false;

    const loadPlace = async () => {
      if (!Number.isFinite(placeId)) {
        setPlace(null);
        setLoading(false);
        setLoadError("Некорректный идентификатор места");
        return;
      }

      setLoading(true);
      setLoadError("");
      try {
        const res = await fetch(`${API_BASE}/api/places`);
        const data = await res.json();

        if (!data.ok) {
          throw new Error(data.message || "Не удалось загрузить место");
        }

        const found = (data.places || []).find((p) => p.id === placeId);
        if (!cancelled) {
          setPlace(found || null);
          if (!found) {
            setLoadError("Место не найдено");
          }
        }
      } catch (e) {
        console.error("Ошибка загрузки места:", e);
        if (!cancelled) {
          setPlace(null);
          setLoadError("Ошибка загрузки места");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPlace();

    return () => {
      cancelled = true;
    };
  }, [placeId]);

  if (loading) {
    return (
      <section className="place-page">
        <div className="container place-page__inner">
          <p>Загружаем место...</p>
        </div>
      </section>
    );
  }

  if (!place) {
    return (
      <section className="place-page">
        <div className="container place-page__inner">
          <p>{loadError || "Место не найдено."}</p>
        </div>
      </section>
    );
  }

  const details = PLACE_DETAILS[placeId] || PLACE_DETAILS.default;
  const placeReviews = reviewsData.filter((r) => r.placeId === placeId);

  const galleryImages = buildGalleryImages(place.image);
  const mainImage = galleryImages[activeIndex] || place.image;

  const hasYandexLink = Boolean(place.link);
  const mapSrc = hasYandexLink
    ? place.link.replace("yandex.ru/maps", "yandex.ru/map-widget/v1")
    : null;

  const handleRouteClick = () => {
    if (place.link) {
      window.open(place.link, "_blank", "noopener,noreferrer");
    } else {
      alert("Ссылка на карту пока недоступна");
    }
  };

  const handleThumbClick = (index) => {
    setActiveIndex(index);
  };

  const openLightbox = () => {
    setIsLightboxOpen(true);
  };

  const closeLightbox = () => {
    setIsLightboxOpen(false);
  };

  const handlePrevImage = () => {
    setActiveIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextImage = () => {
    setActiveIndex((prev) =>
      Math.min(galleryImages.length - 1, prev + 1)
    );
  };

  const toggleFavorite = () => {
    setIsFavorite((prev) => !prev);
  };

  const hasRating = typeof place.rating === "number";
  const ratingValue = hasRating ? place.rating.toFixed(1) : "—";
  const reviewsCount = place.reviews ?? 0;

  return (
    <>
      <section className="place-page">
        <div className="container place-page__inner">
          <div className="place-page__layout">
            {/* ЛЕВАЯ КОЛОНКА */}
            <div className="place-page__main">
              {/* Галерея */}
              <div className="place-page__gallery">
                <div
                  className="place-page__gallery-main"
                  onClick={openLightbox}
                >
                  <img
                    src={mainImage}
                    alt={place.name}
                    className="place-page__gallery-main-img"
                  />
                </div>

                <div className="place-page__gallery-thumbs">
                  {galleryImages.map((src, index) => (
                    <button
                      key={index}
                      type="button"
                      className={
                        "place-page__thumb-btn" +
                        (index === activeIndex
                          ? " place-page__thumb-btn--active"
                          : "")
                      }
                      onClick={() => handleThumbClick(index)}
                    >
                      <img
                        src={src}
                        alt={`${place.name} #${index + 1}`}
                        className="place-page__thumb-img"
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Заголовок и описание */}
              <div className="place-page__header">
                <div className="place-page__chips-row">
                  {place.type && (
                    <span className="place-page__chip">{place.type}</span>
                  )}
                  {place.badge && (
                    <span className="place-page__chip place-page__chip--badge">
                      {place.badge}
                    </span>
                  )}
                </div>

                <h1 className="place-page__title">{place.name}</h1>

                <div className="place-page__meta">
                  {hasRating && (
                    <>
                      <span className="place-page__rating-main">
                        <span className="place-page__rating-star">★</span>
                        {ratingValue}
                        <span className="place-page__rating-count">
                          &nbsp;({reviewsCount} отзывов)
                        </span>
                      </span>
                      <span className="place-page__dot">•</span>
                    </>
                  )}

                  <span className="place-page__address">
                    {place.city && `${place.city}, `}{place.address}
                  </span>
                </div>

                <p className="place-page__description">
                  {details.description}
                </p>
              </div>

              {/* Особенности */}
              <section className="place-page__section">
                <h2 className="place-page__section-title">Особенности</h2>

                <div className="place-page__features-grid">
                  <div className="place-feature">
                    <div className="place-feature__icon">📶</div>
                    <div className="place-feature__content">
                      <div className="place-feature__label">
                        Быстрый Wi-Fi
                      </div>
                      <div className="place-feature__text">
                        {details.wifi}
                      </div>
                    </div>
                  </div>

                  <div className="place-feature">
                    <div className="place-feature__icon">🔌</div>
                    <div className="place-feature__content">
                      <div className="place-feature__label">Розетки</div>
                      <div className="place-feature__text">
                        {details.sockets}
                      </div>
                    </div>
                  </div>

                  <div className="place-feature">
                    <div className="place-feature__icon">🔊</div>
                    <div className="place-feature__content">
                      <div className="place-feature__label">
                        Уровень шума
                      </div>
                      <div className="place-feature__text">
                        {details.noise}
                      </div>
                    </div>
                  </div>

                  <div className="place-feature">
                    <div className="place-feature__icon">💳</div>
                    <div className="place-feature__content">
                      <div className="place-feature__label">
                        Средний чек
                      </div>
                      <div className="place-feature__text">
                        {details.avgCheck}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Отзывы */}
              <section className="place-page__section">
                <div className="place-page__section-header">
                  <h2 className="place-page__section-title">Отзывы</h2>
                  <button
                    type="button"
                    className="place-page__reviews-btn"
                    onClick={() => alert("Здесь позже будет форма отзыва")}
                  >
                    Оставить отзыв
                  </button>
                </div>

                <div className="place-page__reviews-list">
                  {placeReviews.map((review) => {
                    const user = usersData.find(
                      (u) => u.id === review.userId
                    );
                    const initials = getInitials(user?.name);

                    return (
                      <article key={review.id} className="review-card">
                        <div className="review-card__header">
                          <div className="review-card__user">
                            <div className="review-card__avatar">
                              {initials}
                            </div>
                            <div>
                              <div className="review-card__name">
                                {user?.name || "Пользователь"}
                              </div>
                              {user?.role && (
                                <div className="review-card__role">
                                  {user.role}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="review-card__meta">
                            <div className="review-card__stars">
                              {"★".repeat(review.rating)}
                              {"☆".repeat(5 - review.rating)}
                            </div>
                            <div className="review-card__date">
                              {review.date}
                            </div>
                          </div>
                        </div>

                        <p className="review-card__text">{review.text}</p>

                        <button
                          type="button"
                          className="review-card__more-btn"
                          onClick={() =>
                            alert(
                              "Тут будет раскрытие дополнительных комментариев"
                            )
                          }
                        >
                          Показать следующие комментарии
                        </button>
                      </article>
                    );
                  })}

                  {placeReviews.length === 0 && (
                    <p>
                      Пока нет отзывов. Станьте первым, кто поделится
                      впечатлением!
                    </p>
                  )}
                </div>
              </section>
            </div>

            {/* ПРАВАЯ КОЛОНКА */}
            <aside className="place-page__sidebar">
              <div className="place-sidecard">
                <h3 className="place-sidecard__title">Время работы</h3>

                <div className="place-sidecard__rows">
                  <div className="place-sidecard__row">
                    <span>Пн–Пт</span>
                    <span>8:00 – 22:00</span>
                  </div>
                  <div className="place-sidecard__row">
                    <span>Сб–Вс</span>
                    <span>10:00 – 23:00</span>
                  </div>
                </div>
              </div>

              <div className="place-sidecard">
                <h3 className="place-sidecard__title">Адрес</h3>
                <p className="place-sidecard__address">
                  {place.address}
                  {place.city ? `, ${place.city}` : ""}
                </p>

                <div className="place-sidecard__map">
                  {mapSrc ? (
                    <iframe
                      src={mapSrc}
                      title={`Карта: ${place.name}`}
                      className="place-sidecard__map-iframe"
                      allowFullScreen
                    />
                  ) : (
                    <div className="place-sidecard__map-placeholder">
                      Карта недоступна
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="place-sidecard__route-btn"
                  onClick={handleRouteClick}
                >
                  Построить маршрут
                </button>

                <button
                  type="button"
                  className={
                    "place-sidecard__fav-btn" +
                    (isFavorite ? " place-sidecard__fav-btn--active" : "")
                  }
                  onClick={toggleFavorite}
                >
                  {isFavorite ? "В избранном" : "Добавить в избранное"}
                </button>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* Лайтбокс для полноэкранного просмотра */}
      {isLightboxOpen && (
        <div className="place-lightbox" onClick={closeLightbox}>
          <div
            className="place-lightbox__content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="place-lightbox__close"
              onClick={closeLightbox}
            >
              ✕
            </button>

            <img
              src={mainImage}
              alt={place.name}
              className="place-lightbox__img"
            />

            <div className="place-lightbox__controls">
              <button
                type="button"
                onClick={handlePrevImage}
                disabled={activeIndex === 0}
              >
                ←
              </button>
              <span className="place-lightbox__counter">
                {activeIndex + 1} / {galleryImages.length}
              </span>
              <button
                type="button"
                onClick={handleNextImage}
                disabled={activeIndex === galleryImages.length - 1}
              >
                →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}