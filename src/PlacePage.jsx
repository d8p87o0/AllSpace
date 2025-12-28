// src/PlacePage.jsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import reviewsData from "./reviews.json";
import usersData from "./users.json";

const API_BASE = "http://localhost:3001";
const FAVORITES_PREFIX = "favoritePlaces_";
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
// Краткие описания и иконки для фич из БД
const FEATURE_CONFIG = {
  "расположение": {
    icon: "/location-feature.svg",
    label: "Удобное расположение",
    text: "Рядом с метро и ключевыми точками города.",
  },
  "комфортные условия": {
    icon: "/home-feature.svg",
    label: "Комфортные условия",
    text: "Удобная мебель и приятная атмосфера для работы и встреч.",
  },
  "wi-fi": {
    icon: "/wi-fi-feature.svg", // как ты и написал
    label: "Быстрый Wi-Fi",
    text: "Стабильное подключение для звонков и онлайн-работы.",
  },
  "кухня": {
    icon: "/home-feature.svg",
    label: "Кухня / мини-кухня",
    text: "Можно разогреть еду, взять чай или перекус.",
  },
  "гибкие тарифы": {
    icon: "/payment-feature.svg",
    label: "Гибкие тарифы",
    text: "Есть почасовая и долгосрочная аренда.",
  },
  "дизайн": {
    icon: "/design-feature.svg",
    label: "Современный дизайн",
    text: "Эстетичное, продуманное пространство.",
  },
  "тишина": {
    icon: "/home-feature.svg",
    label: "Тихая атмосфера",
    text: "Подходит для сосредоточенной работы и созвонов.",
  },
  "кофе": {
    icon: "/payment-feature.svg",
    label: "Кофе и напитки",
    text: "Вкусный кофе и напитки прямо на месте.",
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

function resolveMediaUrl(url) {
  if (!url) return url;

  // абсолютные ссылки не трогаем
  if (/^https?:\/\//i.test(url)) return url;

  // если это локальная статика сервера: /photos/...
  if (url.startsWith("/photos/")) return `${API_BASE}${url}`;

  // любые другие относительные пути оставляем как есть (например /p1p1.png из public)
  return url;
}

function normalizePhoneForLink(phone) {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[^\d+]/g, "");
  return cleaned || null;
}

function hoursToLines(hours) {
  if (!hours) return [];
  return String(hours)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export default function PlacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const placeId = Number(id);

  const [user, setUser] = useState(null);
  const [place, setPlace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [galleryImages, setGalleryImages] = useState([]);

  const getFavoritesKey = (login) => `${FAVORITES_PREFIX}${login}`;

  // сброс UI при смене id
  useEffect(() => {
    window.scrollTo(0, 0);
    setActiveIndex(0);
    setIsLightboxOpen(false);
    setGalleryImages([]);
    // isFavorite управляется отдельным эффектом
  }, [placeId]);

  useEffect(() => {
    if (!user || !user.login || !Number.isFinite(placeId)) {
      setIsFavorite(false);
      return;
    }

    try {
      const key = getFavoritesKey(user.login);
      const raw = localStorage.getItem(key);
      const ids = raw ? JSON.parse(raw) : [];
      const normalizedIds = Array.isArray(ids) ? ids.map(Number) : [];

      setIsFavorite(normalizedIds.includes(placeId));
    } catch (e) {
      console.error("Не удалось прочитать избранное:", e);
      setIsFavorite(false);
    }
  }, [user, placeId]);

  // читаем текущего пользователя из localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        setUser(JSON.parse(raw));
      } else {
        setUser(null);
      }
    } catch (e) {
      console.error("Не удалось прочитать user из localStorage:", e);
      setUser(null);
    }
  }, []);

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

  // загрузка фото для галереи
  useEffect(() => {
    if (!place) {
      setGalleryImages([]);
      return;
    }

    const fallback = () => {
      const generated = buildGalleryImages(place.image);
      
      if (generated.length) {
        setGalleryImages(generated);
      } else if (place.image) {
        setGalleryImages([place.image]);
      } else {
        setGalleryImages([]);
      }
    };

    function resolveMediaUrl(url) {
      if (!url) return url;
      // если URL начинается с /photos/... — это лежит на API (3001), а не на Vite (5173)
      if (url.startsWith("/photos/")) return `${API_BASE}${url}`;
      return url;
    }
    
    function normalizePhoneForLink(phone) {
      if (!phone) return null;
      // оставим + и цифры
      const cleaned = String(phone).replace(/[^\d+]/g, "");
      return cleaned || null;
    }
    
    function hoursToLines(hours) {
      if (!hours) return [];
      return String(hours)
        .replace(/\r/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    }

    // 1) Если у места есть images из БД — используем их
    if (Array.isArray(place.images) && place.images.length) {
      setGalleryImages(place.images);
      setActiveIndex(0);
      return;
    }

    // 2) Иначе — старый режим: /api/places/:id/photos
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/places/${place.id}/photos`);
        const data = await res.json();
        if (data.ok && Array.isArray(data.photos) && data.photos.length) {
          setGalleryImages(data.photos);
          setActiveIndex(0);
          return;
        }
      } catch (e) {
        console.error("Ошибка загрузки фото места:", e);
      }
      fallback();
    })();
  }, [place]);

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

  const mainImage = resolveMediaUrl(
    galleryImages[activeIndex] || galleryImages[0] || place.image
  );

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
    setActiveIndex((prev) =>
      galleryImages.length ? Math.max(0, prev - 1) : 0
    );
  };

  const handleNextImage = () => {
    setActiveIndex((prev) => {
      if (!galleryImages.length) return 0;
      const last = galleryImages.length - 1;
      return Math.min(last, prev + 1);
    });
  };

  const toggleFavorite = () => {
    // если не авторизован — шлём на логин
    if (!user) {
      navigate("/login");
      return;
    }

    // админ не может добавлять избранное
    if (user.login === "admin") {
      alert("Администратор не может добавлять места в избранное.");
      return;
    }

    const key = getFavoritesKey(user.login);

    try {
      const raw = localStorage.getItem(key);
      const ids = raw ? JSON.parse(raw) : [];
      const normalizedIds = Array.isArray(ids) ? ids.map(Number) : [];

      let nextIds;
      let nextIsFavorite;

      if (normalizedIds.includes(placeId)) {
        // уже было в избранном — удаляем
        nextIds = normalizedIds.filter((id) => id !== placeId);
        nextIsFavorite = false;
      } else {
        // добавляем в избранное
        nextIds = [...normalizedIds, placeId];
        nextIsFavorite = true;
      }

      localStorage.setItem(key, JSON.stringify(nextIds));
      setIsFavorite(nextIsFavorite);
    } catch (e) {
      console.error("Не удалось обновить избранное:", e);
    }
  };

  const hasRating = typeof place.rating === "number";
  const ratingValue = hasRating ? place.rating.toFixed(1) : "—";
  const reviewsCount = place.reviews ?? 0;
  const isFirstImage = activeIndex === 0;
  const isLastImage =
    !galleryImages.length || activeIndex === galleryImages.length - 1;

  return (
    <>
      <section className="place-page">
        <div className="container place-page__inner">
          <div className="place-page__layout">
            {/* ЛЕВАЯ КОЛОНКА */}
            <div className="place-page__main">
              {/* Галерея */}
              <div className="place-page__gallery">
                <div className="place-page__gallery-frame">
                  <div className="place-page__gallery-main" onClick={openLightbox}>
                    <img
                      src={mainImage}
                      alt={place.name}
                      className="place-page__gallery-main-img"
                    />
                  </div>

                  <button
                    type="button"
                    className="place-page__gallery-arrow place-page__gallery-arrow--left"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePrevImage();
                    }}
                    disabled={isFirstImage}
                    aria-label="Предыдущее фото"
                  >
                    ‹
                  </button>

                  <button
                    type="button"
                    className="place-page__gallery-arrow place-page__gallery-arrow--right"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNextImage();
                    }}
                    disabled={isLastImage}
                    aria-label="Следующее фото"
                  >
                    ›
                  </button>
                </div>

                <div className="place-page__gallery-thumbs">
                  {galleryImages.map((src, index) => (
                    <button
                      key={index}
                      type="button"
                      className={
                        "place-page__thumb-btn" +
                        (index === activeIndex ? " place-page__thumb-btn--active" : "")
                      }
                      onClick={() => handleThumbClick(index)}
                    >
                      <img
                        src={resolveMediaUrl(src)}
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
              {/* Особенности */}
              <section className="place-page__section">
                <h2 className="place-page__section-title">Особенности</h2>

                {!place.features || place.features.length === 0 ? (
                  <p className="place-page__features-empty">
                    Информация об особенностях пока не указана.
                  </p>
                ) : (
                  <div className="place-page__features-grid">
                    {place.features.map((feature, index) => {
                      const key = (feature || "").trim().toLowerCase();
                      const cfg =
                        FEATURE_CONFIG[key] || {
                          icon: "/home-feature.svg",
                          label: feature,
                          text: "Особенность этого места.",
                        };

                      return (
                        <div className="place-feature" key={index}>
                          <div className="place-feature__icon">
                            <img
                              src={cfg.icon}
                              alt=""
                              className="place-feature__icon-img"
                            />
                          </div>
                          <div className="place-feature__content">
                            <div className="place-feature__label">{cfg.label}</div>
                            <div className="place-feature__text">{cfg.text}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
            {/* ПРАВАЯ КОЛОНКА */}
            <aside className="place-page__sidebar">
              {/* Время работы — из БД */}
              <div className="place-sidecard">
                <h3 className="place-sidecard__title">Время работы</h3>

                {hoursToLines(place.hours).length ? (
                  <div className="place-sidecard__rows">
                    {hoursToLines(place.hours).map((line, idx) => (
                      <div className="place-sidecard__row" key={idx}>
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="place-sidecard__rows">
                    <div className="place-sidecard__row">
                      <span>Расписание не указано</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Контакты */}
              <div className="place-sidecard">
                <h3 className="place-sidecard__title">Контакты</h3>

                <div className="place-sidecard__rows">
                  <div className="place-sidecard__row">
                    <span>{place.address}</span>
                  </div>

                  {place.phone ? (
                    <div className="place-sidecard__row">
                      <a
                        href={`tel:${normalizePhoneForLink(place.phone) || ""}`}
                        className="place-sidecard__link"
                      >
                        {place.phone}
                      </a>
                    </div>
                  ) : (
                    <div className="place-sidecard__row">
                      <span>Телефон не указан</span>
                    </div>
                  )}
                </div>

                {place.phone && (
                  <a
                    className="place-sidecard__route-btn"
                    href={`sms:${normalizePhoneForLink(place.phone)}`}
                  >
                    Написать
                  </a>
                )}
              </div>

              {/* Адрес + карта + маршрут + избранное */}
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
                    <div className="place-sidecard__map-placeholder">Карта недоступна</div>
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

            <div className="place-lightbox__img-wrap">
              <img
                src={mainImage}
                alt={place.name}
                className="place-lightbox__img"
              />
              <button
                type="button"
                className="place-lightbox__arrow place-lightbox__arrow--left"
                onClick={handlePrevImage}
                disabled={isFirstImage}
                aria-label="Предыдущее фото"
              >
                ‹
              </button>
              <button
                type="button"
                className="place-lightbox__arrow place-lightbox__arrow--right"
                onClick={handleNextImage}
                disabled={isLastImage}
                aria-label="Следующее фото"
              >
                ›
              </button>
            </div>

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
