import { useEffect, useState, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import placesData from "./places.json";
import PlacePage from "./PlacePage.jsx";
import "./App.css";
import RegisterPage from "./register.jsx";
import LoginPage from "./login.jsx";

const CITIES = [
  { id: "moscow", name: "Москва", top: "63%", left: "37%" },
  { id: "spb", name: "Санкт-Петербург", top: "49%", left: "34%" },
  { id: "rostov", name: "Ростов-на-Дону", top: "73%", left: "35%" },
  { id: "omsk", name: "Омск", top: "69%", left: "61%" },
  { id: "nn", name: "Нижний Новгород", top: "59%", left: "41%" },
  { id: "kazan", name: "Казань", top: "63%", left: "44%" },
  { id: "samara", name: "Самара", top: "67%", left: "44%" },
  { id: "volgograd", name: "Волгоград", top: "75%", left: "40%" },
  { id: "voronezh", name: "Воронеж", top: "69%", left: "38%" },
  { id: "ufa", name: "Уфа", top: "64%", left: "50%" },
  { id: "perm", name: "Пермь", top: "59%", left: "50%" },
  { id: "ekb", name: "Екатеринбург", top: "60%", left: "54%" },
  { id: "chelyabinsk", name: "Челябинск", top: "65%", left: "56%" },
  { id: "novosibirsk", name: "Новосибирск", top: "69%", left: "66%" },
  { id: "krasnoyarsk", name: "Красноярск", top: "64%", left: "72%" },
  { id: "vladivostok", name: "Владивосток", top: "85%", left: "88%" }
];

const PAGE_SIZE = 9;

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function App() {
  const [orderedCities, setOrderedCities] = useState([]);
  const [visibleCount, setVisibleCount] = useState(0);

  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // активный фильтр (для десктопа и карусели на мобиле)
  const [activeFilterIndex, setActiveFilterIndex] = useState(0);

  // текущая страница каталога
  const [currentPage, setCurrentPage] = useState(1);

  const navigate = useNavigate();

  const catalogRef = useRef(null);
  // скроллить ли к каталогу после смены страницы
  const shouldScrollAfterPageChange = useRef(false);

  const totalPages = Math.max(
    1,
    Math.ceil(placesData.length / PAGE_SIZE)
  );

  // гарантируем, что не уйдём за последнюю страницу
  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const visiblePlaces = placesData.slice(startIndex, startIndex + PAGE_SIZE);

  useEffect(() => {
    // скроллим только если перед этим пользователь нажал кнопку пагинации
    if (!shouldScrollAfterPageChange.current) return;

    shouldScrollAfterPageChange.current = false;
    if (!catalogRef.current) return;

    const headerOffset = 80; // можно подстроить под высоту шапки
    const rect = catalogRef.current.getBoundingClientRect();
    const absoluteTop = rect.top + window.scrollY;
    const targetTop = absoluteTop - headerOffset;

    window.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  }, [safeCurrentPage]);

  const handlePageClick = (page) => {
    shouldScrollAfterPageChange.current = true;
    setCurrentPage(page);
  };

  const handlePrev = () => {
    setCurrentPage((prev) => {
      const next = Math.max(1, prev - 1);
      if (next !== prev) {
        shouldScrollAfterPageChange.current = true;
      }
      return next;
    });
  };

  const handleNext = () => {
    setCurrentPage((prev) => {
      const next = Math.min(totalPages, prev + 1);
      if (next !== prev) {
        shouldScrollAfterPageChange.current = true;
      }
      return next;
    });
  };

  // --- Яндекс-карта "маршрут к рабочему месту мечты" ---
  useEffect(() => {
    if (typeof window === "undefined") return;

    const initMap = () => {
      if (!window.ymaps) return;
      const container = document.getElementById("yandex-map");
      if (!container) return;

      if (container.dataset.inited === "true") return;
      container.dataset.inited = "true";

      const map = new window.ymaps.Map("yandex-map", {
        center: [55.751244, 37.618423],
        zoom: 11,
        controls: ["zoomControl", "geolocationControl"]
      });

      const placemark = new window.ymaps.Placemark(
        [55.751244, 37.618423],
        {
          hintContent: "Рабочее место мечты",
          balloonContent: "Пример точки на карте"
        },
        {
          preset: "islands#greenIcon"
        }
      );

      map.geoObjects.add(placemark);
    };

    if (window.ymaps) {
      window.ymaps.ready(initMap);
      return;
    }

    const existingScript = document.querySelector(
      'script[src^="https://api-maps.yandex.ru/2.1/"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", () =>
        window.ymaps.ready(initMap)
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://api-maps.yandex.ru/2.1/?lang=ru_RU";
    script.async = true;
    script.onload = () => window.ymaps.ready(initMap);
    document.body.appendChild(script);
  }, []);

  // --- анимация городов на карте ---
  useEffect(() => {
    const fixed = CITIES.slice(0, 4);
    const shuffledRest = shuffle(CITIES.slice(4));
    setOrderedCities([...fixed, ...shuffledRest]);
  }, []);

  useEffect(() => {
    if (!orderedCities.length) return;

    setVisibleCount(4);

    const interval = setInterval(() => {
      setVisibleCount((prev) => {
        if (prev >= orderedCities.length) {
          clearInterval(interval);
          return prev;
        }
        return Math.min(prev + 4, orderedCities.length);
      });
    }, 800);

    return () => clearInterval(interval);
  }, [orderedCities]);

  const filterTabs = [
    "Город",
    "Тип помещения",
    "Уровень шума",
    "Цены",
    "Рейтинг",
    "Удобства"
  ];

  const handleFilterPrev = () => {
    setActiveFilterIndex(
      (prev) => (prev - 1 + filterTabs.length) % filterTabs.length
    );
  };

  const handleFilterNext = () => {
    setActiveFilterIndex((prev) => (prev + 1) % filterTabs.length);
  };

  // клик по кнопке "Профиль" — теперь ведёт на /login
  const handleProfileClick = () => {
    if (!isLoggedIn) {
      navigate("/login");
    } else {
      console.log("Открываем профиль пользователя");
    }
  };

  return (
    <div className="page">
      {/* Шапка */}
      <header className="header">
        <div className="container header__inner">
          <div className="logo" onClick={() => navigate("/")}>
            <img src="/logo1.svg" alt="SPACE logo" className="logo__image" />
          </div>

          <button className="profile-btn" onClick={handleProfileClick}>
            <span className="profile-btn__icon">
              <img src="/account.svg" alt="Профиль" className="logo__image" />
            </span>
            <span className="profile-btn__text">Профиль</span>
          </button>
        </div>
      </header>

      <main className="main">
        <Routes>
          {/* ГЛАВНАЯ СТРАНИЦА */}
          <Route
            path="/"
            element={
              <>
                {/* Hero */}
                <section className="hero">
                  <div className="hero__overlay" />
                  <div className="container hero__content">
                    <h1 className="hero__title">
                      Найди идеальное место
                      <br />
                      для работы
                    </h1>

                    <p className="hero__subtitle">
                      Тысячи проверенных кафе, коворкингов и библиотек с
                      Wi-Fi, розетками и комфортной атмосферой.
                    </p>

                    <button className="hero__cta">Погнали</button>
                  </div>
                </section>

                {/* Преимущества */}
                <section className="features">
                  <div className="container features__grid">
                    <div className="feature-card">
                      <div className="feature-card__icon">
                        <img
                          src="/geo.svg"
                          alt=""
                          className="feature-card__icon-img"
                        />
                      </div>
                      <h3 className="feature-card__title">
                        Точные адреса
                      </h3>
                      <p className="feature-card__text">
                        Все места проверены и отмечены на карте.
                      </p>
                    </div>

                    <div className="feature-card">
                      <div className="feature-card__icon">
                        <img
                          src="/star.svg"
                          alt=""
                          className="feature-card__icon-img"
                        />
                      </div>
                      <h3 className="feature-card__title">
                        Честные отзывы
                      </h3>
                      <p className="feature-card__text">
                        Реальные впечатления от посетителей.
                      </p>
                    </div>

                    <div className="feature-card">
                      <div className="feature-card__icon">
                        <img
                          src="/lightning.svg"
                          alt=""
                          className="feature-card__icon-img"
                        />
                      </div>
                      <h3 className="feature-card__title">
                        Умные фильтры
                      </h3>
                      <p className="feature-card__text">
                        Найди место по своим критериям.
                      </p>
                    </div>
                  </div>
                </section>

                {/* Карта с городами */}
                <section className="map-section">
                  <div className="container map-section__content">
                    <h2 className="map-section__title">
                      Находи места по всей России
                    </h2>
                    <p className="map-section__subtitle">
                      Мы представлены во всех городах-миллионниках
                    </p>

                    <div className="map-section__map-wrapper">
                      <img
                        src="/map-russia.png"
                        alt="Карта России"
                        className="map-section__map-img"
                      />

                      {orderedCities.map((city, index) => {
                        const isVisible = index < visibleCount;
                        return (
                          <div
                            key={city.id}
                            className={
                              "city-marker" +
                              (isVisible ? " city-marker--visible" : "")
                            }
                            style={{ top: city.top, left: city.left }}
                          >
                            <img
                              src="/pin-18.png"
                              alt=""
                              className="city-marker__pin"
                            />
                            <span className="city-marker__label">
                              {city.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                {/* КАТАЛОГ МЕСТ */}
                <section className="catalog" ref={catalogRef}>
                  <div className="container">
                    {/* Фильтры — десктопная версия */}
                    <div className="catalog__filters catalog__filters-desktop">
                      {filterTabs.map((label, index) => (
                        <button
                          key={label}
                          type="button"
                          className={
                            "catalog__filter" +
                            (index === activeFilterIndex
                              ? " catalog__filter--active"
                              : "")
                          }
                          onClick={() => setActiveFilterIndex(index)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Фильтры — мобильная карусель */}
                    <div className="catalog__filters-mobile">
                      <div className="catalog__filters-mobile-box">
                        <button
                          type="button"
                          className="catalog__filters-arrow catalog__filters-arrow--left"
                          onClick={handleFilterPrev}
                        >
                          ←
                        </button>

                        <div className="catalog__filters-mobile-center">
                          <span
                            key={activeFilterIndex}
                            className="catalog__filters-mobile-label"
                          >
                            {filterTabs[activeFilterIndex]}
                          </span>
                        </div>

                        <button
                          type="button"
                          className="catalog__filters-arrow catalog__filters-arrow--right"
                          onClick={handleFilterNext}
                        >
                          →
                        </button>
                      </div>
                    </div>

                    {/* Сетка карточек */}
                    <div className="catalog__grid">
                      {visiblePlaces.map((place) => (
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
                                <h3 className="place-card__title">
                                  {place.name}
                                </h3>
                                <p className="place-card__type">
                                  {place.type}
                                </p>
                              </div>

                              <div className="place-card__rating">
                                <span className="place-card__rating-icon">
                                  ★
                                </span>
                                <span className="place-card__rating-value">
                                  {place.rating.toFixed(1)}
                                </span>
                                <span className="place-card__rating-count">
                                  ({place.reviews})
                                </span>
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
                              {place.features.map((feature) => (
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

                    {/* ПАГИНАЦИЯ */}
                    <div className="catalog__pagination">
                      <button
                        type="button"
                        className="catalog__pagination-btn"
                        onClick={handlePrev}
                        disabled={
                          safeCurrentPage === 1 ||
                          placesData.length === 0
                        }
                      >
                        ←Назад
                      </button>

                      {/* Номера страниц — только на десктопе */}
                      <div className="catalog__pagination-pages">
                        {Array.from(
                          { length: totalPages },
                          (_, index) => {
                            const page = index + 1;
                            return (
                              <button
                                key={page}
                                type="button"
                                className={
                                  "catalog__page-btn" +
                                  (page === safeCurrentPage
                                    ? " catalog__page-btn--active"
                                    : "")
                                }
                                onClick={() => handlePageClick(page)}
                              >
                                {page}
                              </button>
                            );
                          }
                        )}
                      </div>

                      {/* Текущий номер — на мобильных */}
                      <div className="catalog__pagination-current-mobile">
                        {safeCurrentPage}
                      </div>

                      <button
                        type="button"
                        className="catalog__pagination-btn"
                        onClick={handleNext}
                        disabled={
                          safeCurrentPage === totalPages ||
                          placesData.length === 0
                        }
                      >
                        Далее→
                      </button>
                    </div>
                  </div>
                </section>

                {/* Яндекс-карта: построить маршрут */}
                <section className="route-map">
                  <div className="route-map__inner">
                    <h2 className="route-map__title">
                      Построй маршрут к рабочему месту мечты
                    </h2>

                    <div className="route-map__map-wrapper">
                      <div id="yandex-map" className="route-map__map" />
                    </div>
                  </div>
                </section>

                {/* CTA снизу */}
                <section className="footer-cta">
                  <div className="footer-cta__inner">
                    <h2 className="footer-cta__title">
                      Знаешь отличное место?
                    </h2>
                    <p className="footer-cta__subtitle">
                      Поделись с сообществом и помоги другим найти идеальное
                      пространство для работы
                    </p>
                    <button
                      className="footer-cta__btn"
                      onClick={handleProfileClick}
                    >
                      Добавить
                    </button>
                  </div>
                </section>
              </>
            }
          />

          {/* СТРАНИЦА КОНКРЕТНОГО МЕСТА */}
          <Route path="/place/:id" element={<PlacePage />} />

          {/* СТРАНИЦА РЕГИСТРАЦИИ */}
          <Route path="/register" element={<RegisterPage />} />

          {/* СТРАНИЦА ВХОДА */}
          <Route
            path="/login"
            element={<LoginPage onLogin={() => setIsLoggedIn(true)} />}
          />
        </Routes>
      </main>

      {/* Нижний футер */}
      <footer className="footer">
        <div className="container footer__inner">
          <div className="footer__brand">
            <div className="footer__logo-circle">
              <img src="/geo.svg" alt="" className="footer__logo-icon" />
            </div>
            <span className="footer__brand-name">ALLSPACE</span>
          </div>

          <div className="footer__copy">
            © {new Date().getFullYear()} ALLSPACE. Все права защищены.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;