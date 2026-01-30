import { useEffect, useState, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
// import placesData from "./places.json"; // больше не нужно
import PlacePage from "./PlacePage.jsx";
import "./App.css";
import RegisterPage from "./register.jsx";
import LoginPage from "./login.jsx";
import VerifyEmailPage from "./VerifyEmailPage.jsx";
import { ProfilePage } from "./ProfilePage.jsx";
import AdminPage from "./Admin.jsx";
import SubmitPlacePage from "./SubmitPlace.jsx";


const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

function resolveMediaUrl(url) {
  if (!url) return url;

  // абсолютные ссылки не трогаем
  if (/^https?:\/\//i.test(url)) return url;

  // серверная статика лежит на 
  if (url.startsWith("/photos/")) return `${API_BASE}${url}`;

  // например /p1p1.png из public
  return url;
}

function getCover(place) {
  const fromImage = place?.image;
  const fromGallery = Array.isArray(place?.images) && place.images.length ? place.images[0] : null;
  return fromImage || fromGallery || "/no-photo.png"; // можешь заменить на свою заглушку
}

const CITIES = [
  { id: "moscow", name: "Москва", top: "47%", left: "14%" },
  { id: "spb", name: "Санкт-Петербург", top: "33%", left: "15%" },
  { id: "rostov", name: "Ростов-на-Дону", top: "65%", left: "8%" },
  { id: "omsk", name: "Омск", top: "74%", left: "36%" },
  { id: "nn", name: "Нижний Новгород", top: "53%", left: "18%" },
  { id: "kazan", name: "Казань", top: "61%", left: "20%" },
  { id: "samara", name: "Самара", top: "67%", left: "18%" },
  { id: "volgograd", name: "Волгоград", top: "67%", left: "13%" },
  { id: "voronezh", name: "Воронеж", top: "58%", left: "10%" },
  { id: "ufa", name: "Уфа", top: "73%", left: "32%" },
  { id: "perm", name: "Пермь", top: "60%", left: "27%" },
  { id: "ekb", name: "Екатеринбург", top: "65%", left: "30%" },
  { id: "chelyabinsk", name: "Челябинск", top: "71%", left: "29%" },
  { id: "novosibirsk", name: "Новосибирск", top: "82%", left: "42%" },
  { id: "krasnoyarsk", name: "Красноярск", top: "80%", left: "50%" },
  { id: "vladivostok", name: "Владивосток", top: "85%", left: "88%" },
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
  const navigate = useNavigate();

  const [orderedCities, setOrderedCities] = useState([]);
  const [visibleCount, setVisibleCount] = useState(0);

  const [isLoggedIn, setIsLoggedIn] = useState(false);

  
  // ======= МЕСТА ИЗ API =======
  const [places, setPlaces] = useState([]);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [placesError, setPlacesError] = useState("");
  
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      setIsLoggedIn(!!raw);
    } catch (e) {
      console.error("Не удалось прочитать user из localStorage:", e);
      setIsLoggedIn(false);
    }
  }, []);
  
  useEffect(() => {
    const fetchPlaces = async () => {
      setPlacesLoading(true);
      setPlacesError("");
      try {
        const res = await fetch(`${API_BASE}/api/places`);
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.message || "Не удалось загрузить места");
        }
        setPlaces(data.places || []);
      } catch (e) {
        console.error("Ошибка загрузки мест:", e);
        setPlacesError("Не удалось загрузить места");
      } finally {
        setPlacesLoading(false);
      }
    };
    
    fetchPlaces();
  }, []);
  
  // ======= ФИЛЬТРЫ =======
  // активный таб (подсветка)
  const [activeFilterIndex, setActiveFilterIndex] = useState(0);
  // какой фильтр сейчас открыт дропдауном (null = ничего)
  const [openFilterIndex, setOpenFilterIndex] = useState(null);
  // строка поиска внутри текущего дропдауна
  const [filterSearch, setFilterSearch] = useState("");
  
  // текущая страница каталога
  const [currentPage, setCurrentPage] = useState(1);
  
  const catalogRef = useRef(null);
  const shouldScrollAfterPageChange = useRef(false);
  
  // выбранные значения по каждому фильтру (по умолчанию пустые — "ничего не отфильтровано")
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedCities, setSelectedCities] = useState([]);
  const [selectedBadges, setSelectedBadges] = useState([]);
  const [selectedRatings, setSelectedRatings] = useState([]);
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  
  // --- все возможные значения по данным из places (из БД) ---
  const allPlaceTypes = Array.from(
    new Set(
      (places || [])
      .map((p) => (p.type || "").trim())
      .filter(Boolean)
    )
  );
  
  const handleLogoClick = () => {
    // полный перезапуск приложения на главной
    window.location.href = "/";
  };
  
  const allCities = Array.from(
    new Set(
      (places || [])
      .map((p) => (p.city || "").trim())
      .filter(Boolean)
    )
  );

  const allBadges = Array.from(
    new Set(
      (places || [])
        .map((p) => (p.badge || "").trim())
        .filter(Boolean)
    )
  );

  const allRatings = Array.from(
    new Set(
      (places || [])
        .map((p) =>
          typeof p.rating === "number" ? p.rating.toFixed(1) : ""
        )
        .filter(Boolean)
    )
  );

  const allFeatures = Array.from(
    new Set(
      (places || [])
        .flatMap((p) => p.features || [])
        .map((f) => (f || "").trim())
        .filter(Boolean)
    )
  );

  // при первой загрузке данных из БД — включаем все опции как выбранные
  useEffect(() => {
    if (allPlaceTypes.length && selectedTypes.length === 0) {
      setSelectedTypes(allPlaceTypes);
    }
  }, [allPlaceTypes, selectedTypes.length]);

  useEffect(() => {
    if (allCities.length && selectedCities.length === 0) {
      setSelectedCities(allCities);
    }
  }, [allCities, selectedCities.length]);

  useEffect(() => {
    if (allBadges.length && selectedBadges.length === 0) {
      setSelectedBadges(allBadges);
    }
  }, [allBadges, selectedBadges.length]);

  useEffect(() => {
    if (allRatings.length && selectedRatings.length === 0) {
      setSelectedRatings(allRatings);
    }
  }, [allRatings, selectedRatings.length]);


  // --- функции переключения опций в дропдауне ---
  const toggleTypeOption = (type) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
    setCurrentPage(1);
  };

  const toggleCityOption = (city) => {
    setSelectedCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
    setCurrentPage(1);
  };

  const toggleBadgeOption = (badge) => {
    setSelectedBadges((prev) =>
      prev.includes(badge) ? prev.filter((b) => b !== badge) : [...prev, badge]
    );
    setCurrentPage(1);
  };

  const toggleRatingOption = (rating) => {
    setSelectedRatings((prev) =>
      prev.includes(rating) ? prev.filter((r) => r !== rating) : [...prev, rating]
    );
    setCurrentPage(1);
  };

  const toggleFeatureOption = (feature) => {
    setSelectedFeatures((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]
    );
    setCurrentPage(1);
  };

  // --- конфиг для каждого таба фильтра ---
  const filterTabs = [
    "Город",
    "Тип помещения",
    "Уровень шума",
    "Цены",
    "Рейтинг",
    "Удобства",
  ];

  const getFilterConfig = (index) => {
    switch (index) {
      case 0:
        return {
          allOptions: allCities,
          selected: selectedCities,
          toggle: toggleCityOption,
          placeholder: "Поиск по городу",
        };
      case 1:
        return {
          allOptions: allPlaceTypes,
          selected: selectedTypes,
          toggle: toggleTypeOption,
          placeholder: "Поиск по типу",
        };
      case 3:
        return {
          allOptions: allBadges,
          selected: selectedBadges,
          toggle: toggleBadgeOption,
          placeholder: "Поиск по ценам",
        };
      case 4:
        return {
          allOptions: allRatings,
          selected: selectedRatings,
          toggle: toggleRatingOption,
          placeholder: "Поиск по рейтингу",
        };
      case 5:
        return {
          allOptions: allFeatures,
          selected: selectedFeatures,
          toggle: toggleFeatureOption,
          placeholder: "Поиск по удобствам",
        };
      // "Уровень шума" (index=2) — пока нет поля в данных
      default:
        return {
          allOptions: [],
          selected: [],
          toggle: () => {},
          placeholder: "Нет данных для этого фильтра",
        };
    }
  };

  const currentFilterConfig = getFilterConfig(openFilterIndex);
  const filteredOptions = currentFilterConfig.allOptions.filter((opt) =>
    opt.toLowerCase().includes(filterSearch.toLowerCase())
  );

  // --- применяем фильтры к данным из БД ---
  const filteredPlaces = places.filter((place) => {
    // тип
    if (selectedTypes.length && place.type && !selectedTypes.includes(place.type)) {
      return false;
    }

    // город
    if (selectedCities.length && place.city && !selectedCities.includes(place.city)) {
      return false;
    }

    // цены = badge
    if (selectedBadges.length && place.badge) {
      if (!selectedBadges.includes(place.badge)) return false;
    }

    // рейтинг
    if (selectedRatings.length && typeof place.rating === "number") {
      const ratingKey = place.rating.toFixed(1);
      if (!selectedRatings.includes(ratingKey)) return false;
    }

    // удобства: место должно содержать хотя бы одно выбранное удобство
    if (selectedFeatures.length) {
      const feats = place.features || [];
      const hasAny = feats.some((f) => selectedFeatures.includes(f));
      if (!hasAny) return false;
    }

    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredPlaces.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const visiblePlaces = filteredPlaces.slice(startIndex, startIndex + PAGE_SIZE);

  const hasPlaces = filteredPlaces.length > 0;

  useEffect(() => {
    if (!shouldScrollAfterPageChange.current) return;

    shouldScrollAfterPageChange.current = false;
    if (!catalogRef.current) return;

    const headerOffset = 80;
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

  const scrollToCatalog = () => {
    if (!catalogRef.current) return;

    const headerOffset = 80;
    const rect = catalogRef.current.getBoundingClientRect();
    const absoluteTop = rect.top + window.scrollY;
    const targetTop = absoluteTop - headerOffset;

    window.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  };

  // --- Яндекс-карта ---
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
        controls: ["zoomControl", "geolocationControl"],
      });

      const placemark = new window.ymaps.Placemark(
        [55.751244, 37.618423],
        {
          hintContent: "Рабочее место мечты",
          balloonContent: "Пример точки на карте",
        },
        {
          preset: "islands#greenIcon",
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
      existingScript.addEventListener("load", () => window.ymaps.ready(initMap));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://api-maps.yandex.ru/2.1/?lang=ru_RU";
    script.async = true;
    script.onload = () => window.ymaps.ready(initMap);
    document.body.appendChild(script);
  }, []);

  // --- анимация городов ---
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

  const handleFilterTabClick = (index) => {
    setActiveFilterIndex(index);
    setFilterSearch("");

    setOpenFilterIndex((prev) => (prev === index ? null : index));
  };

  const handleFilterPrev = () => {
    setActiveFilterIndex((prev) => {
      const next = (prev - 1 + filterTabs.length) % filterTabs.length;
      setOpenFilterIndex(null);
      return next;
    });
  };

  const handleFilterNext = () => {
    setActiveFilterIndex((prev) => {
      const next = (prev + 1) % filterTabs.length;
      setOpenFilterIndex(null);
      return next;
    });
  };

  const handleProfileClick = () => {
    try {
      const raw = localStorage.getItem("user");

      // Если пользователь не залогинен — отправляем на логин
      if (!raw) {
        navigate("/login");
        return;
      }

      const u = JSON.parse(raw);

      // Если это админ — всегда ведём в /admin
      if (u.login === "admin") {
        navigate("/admin");
      } else {
        navigate("/profile");
      }
    } catch (e) {
      console.error("Не удалось прочитать user из localStorage:", e);
      navigate("/login");
    }
  };

  const handleSubmitPlaceClick = () => {
    try {
      const raw = localStorage.getItem("user");

      if (!raw) {
        navigate("/login");
        return;
      }

      const u = JSON.parse(raw);

      if (u.login === "admin") {
        navigate("/admin");
        return;
      }

      navigate("/submit-place");
    } catch (e) {
      console.error("Не удалось прочитать user из localStorage:", e);
      navigate("/login");
    }
  };

  return (
    <div className="page">
      {/* Шапка */}
      <header className="header">
        <div className="container header__inner">
        <div className="logo" onClick={handleLogoClick}>
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
                  <video
                    className="hero__bg-video"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    onError={(e) => console.log("VIDEO ERROR", e)}
                  >
                    <source src="/hero-bg.mp4" type="video/mp4" />
                  </video>

                  <div className="hero__overlay" />
                  <div className="container hero__content">
                    <h1 className="hero__title">
                      Найди идеальное место
                      <br />
                      для работы
                    </h1>

                    <p className="hero__subtitle">
                      Тысячи проверенных кафе, коворкингов и библиотек с Wi-Fi,
                      розетками и комфортной атмосферой.
                    </p>
                    <button className="hero__cta" onClick={scrollToCatalog}>
                      Погнали
                    </button>
                  </div>
                </section>

                <section className="features">
                  <div className="container features__grid">
                    <div className="feature-card">
                      <div className="feature-card__icon">
                        <img src="/geo.svg" alt="" className="feature-card__icon-img" />
                      </div>
                      <h3 className="feature-card__title">Точные адреса</h3>
                      <p className="feature-card__text">
                        Все места проверены и отмечены на карте.
                      </p>
                    </div>

                    <div className="feature-card">
                      <div className="feature-card__icon">
                        <img src="/star.svg" alt="" className="feature-card__icon-img" />
                      </div>
                      <h3 className="feature-card__title">Честные отзывы</h3>
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
                      <h3 className="feature-card__title">Умные фильтры</h3>
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
                        src="/map-russia-new 1.png"
                        alt="Карта России"
                        className="map-section__map-img"
                      />

                      {orderedCities.map((city, index) => {
                        const isVisible = index < visibleCount;
                        return (
                          <div
                            key={city.id}
                            className={
                              "city-marker" + (isVisible ? " city-marker--visible" : "")
                            }
                            style={{
                              top: city.top,
                              left: city.left,
                            }}
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
                    {/* Обёртка фильтров + дропдаун */}
                    <div className="catalog__filters-wrapper">
                      {/* Фильтры — десктоп */}
                      <div className="catalog__filters catalog__filters-desktop">
                        {filterTabs.map((label, index) => {
                          const isActive = index === activeFilterIndex;

                          return (
                            <button
                              key={label}
                              type="button"
                              className={
                                "catalog__filter" +
                                (isActive ? " catalog__filter--active" : "")
                              }
                              onClick={() => handleFilterTabClick(index)}
                            >
                              {label}
                            </button>
                          );
                        })}
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
                            <button
                              type="button"
                              className="catalog__filters-mobile-label-btn"
                              onClick={() => {
                                setOpenFilterIndex((prev) =>
                                  prev === activeFilterIndex ? null : activeFilterIndex
                                );
                              }}
                            >
                              {filterTabs[activeFilterIndex]}
                            </button>
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

                      {/* Универсальный дропдаун для всех фильтров */}
                      {openFilterIndex !== null && (
                        <div className="catalog-filter-dropdown">
                          <input
                            type="text"
                            className="catalog-filter-dropdown__search"
                            placeholder={currentFilterConfig.placeholder}
                            value={filterSearch}
                            onChange={(e) => setFilterSearch(e.target.value)}
                          />

                          <div className="catalog-filter-dropdown__list">
                            {filteredOptions.length === 0 ? (
                              <div className="catalog-filter-dropdown__empty">
                                Ничего не найдено
                              </div>
                            ) : (
                              filteredOptions.map((option) => {
                                const checked =
                                  currentFilterConfig.selected.includes(option);
                                return (
                                  <button
                                    key={option}
                                    type="button"
                                    className="catalog-filter-dropdown__item"
                                    onClick={() =>
                                      currentFilterConfig.toggle(option)
                                    }
                                  >
                                    <span
                                      className={
                                        "catalog-filter-dropdown__check" +
                                        (checked
                                          ? " catalog-filter-dropdown__check--active"
                                          : "")
                                      }
                                    >
                                      {checked ? "✓" : ""}
                                    </span>
                                    <span>{option}</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Сообщения про загрузку / ошибку */}
                    {placesLoading && !places.length && (
                      <p className="admin__hint">Загружаем места...</p>
                    )}
                    {placesError && (
                      <p className="admin__alert admin__alert--error">
                        {placesError}
                      </p>
                    )}

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
                            src={resolveMediaUrl(getCover(place))}
                            alt={place.name}
                            className="place-card__image"
                            onError={(e) => {
                              e.currentTarget.src = "/no-photo.png"; // заглушка (положи в /public)
                            }}
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

                              {typeof place.rating === "number" && (
                                <div className="place-card__rating">
                                  <span className="place-card__rating-icon">
                                    ★
                                  </span>
                                  <span className="place-card__rating-value">
                                    {place.rating.toFixed(1)}
                                  </span>
                                  <span className="place-card__rating-count">
                                    ({place.reviews ?? 0})
                                  </span>
                                </div>
                              )}
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

                    {/* Пагинация */}
                    <div className="catalog__pagination">
                      <button
                        type="button"
                        className="catalog__pagination-btn"
                        onClick={handlePrev}
                        disabled={safeCurrentPage === 1 || !hasPlaces}
                      >
                        ←Назад
                      </button>

                      <div className="catalog__pagination-pages">
                        {Array.from({ length: totalPages }, (_, index) => {
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
                        })}
                      </div>

                      <div className="catalog__pagination-current-mobile">
                        {safeCurrentPage}
                      </div>

                      <button
                        type="button"
                        className="catalog__pagination-btn"
                        onClick={handleNext}
                        disabled={safeCurrentPage === totalPages || !hasPlaces}
                      >
                        Далее→
                      </button>
                    </div>
                  </div>
                </section>

                {/* Яндекс-карта: маршрут */}
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
                    <button className="footer-cta__btn" onClick={handleSubmitPlaceClick}>
			Добавить
		    </button>
                  </div>
                </section>
              </>
            }
          />

          {/* Страница места */}
          <Route path="/place/:id" element={<PlacePage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route
            path="/login"
            element={<LoginPage onLogin={() => setIsLoggedIn(true)} />}
          />
          <Route
            path="/profile"
            element={<ProfilePage onLogout={() => setIsLoggedIn(false)} />}
          />
          <Route path="/admin" element={<AdminPage />} />
	  <Route path="/submit-place" element={<SubmitPlacePage />} />
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
