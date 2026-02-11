// src/PlacePage.jsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "/api" : "http://localhost:3001");
const FAVORITES_PREFIX = "favoritePlaces_";
const REVIEW_IMAGES_LIMIT = 6;
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

function isSameUser(review, currentUser) {
  if (!review || !currentUser) return false;

  const currentUserId = Number(currentUser.id);
  const reviewUserId = Number(review.userId);
  if (
    Number.isFinite(currentUserId) &&
    Number.isFinite(reviewUserId) &&
    currentUserId === reviewUserId
  ) {
    return true;
  }

  const userLogin = (currentUser.login || "").trim();
  const reviewLogin = (review.userLogin || "").trim();
  return Boolean(userLogin && reviewLogin && userLogin === reviewLogin);
}

function formatReviewDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewImages, setReviewImages] = useState([]);
  const [reviewImageError, setReviewImageError] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [isReviewFormOpen, setIsReviewFormOpen] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState(null);
  const [editReviewText, setEditReviewText] = useState("");
  const [editReviewRating, setEditReviewRating] = useState(5);
  const [editReviewImages, setEditReviewImages] = useState([]);
  const [editReviewImageError, setEditReviewImageError] = useState("");
  const [editReviewError, setEditReviewError] = useState("");
  const [editReviewSaving, setEditReviewSaving] = useState(false);
  const [reviewDeletingId, setReviewDeletingId] = useState(null);
  const [reviewActionError, setReviewActionError] = useState("");


  const getFavoritesKey = (login) => `${FAVORITES_PREFIX}${login}`;
  const clearReviewImages = () => {
    setReviewImages((prev) => {
      prev.forEach((img) => {
        if (img.previewUrl) {
          URL.revokeObjectURL(img.previewUrl);
        }
      });
      return [];
    });
  };
  const clearEditReviewImages = () => {
    setEditReviewImages((prev) => {
      prev.forEach((img) => {
        if (img?.file && img.previewUrl) {
          URL.revokeObjectURL(img.previewUrl);
        }
      });
      return [];
    });
  };

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

  useEffect(() => {
    setReviewText("");
    setReviewRating(5);
    clearReviewImages();
    setReviewImageError("");
    setSubmitMessage("");
    setIsReviewFormOpen(false);
    clearEditReviewImages();
    setEditingReviewId(null);
    setEditReviewText("");
    setEditReviewRating(5);
    setEditReviewImageError("");
    setEditReviewError("");
    setEditReviewSaving(false);
    setReviewDeletingId(null);
    setReviewActionError("");

    if (!Number.isFinite(placeId)) {
      setReviews([]);
      setReviewsError("Некорректный id");
      return;
    }

    let cancelled = false;

    const loadReviews = async () => {
      setReviewsLoading(true);
      setReviewsError("");
      setSubmitMessage("");
      setReviewActionError("");

      try {
        const res = await fetch(`${API_BASE}/api/places/${placeId}/reviews`);
        const data = await res.json();

        if (!data.ok) {
          throw new Error(data.message || "Не удалось загрузить отзывы");
        }

        if (!cancelled) {
          const list = Array.isArray(data.reviews) ? data.reviews : [];
          setReviews(list);

          if (data.stats) {
            setPlace((prev) =>
              prev
                ? {
                    ...prev,
                    rating:
                      data.stats.average === undefined
                        ? prev.rating
                        : data.stats.average,
                    reviews:
                      data.stats.count === undefined
                        ? prev.reviews
                        : data.stats.count,
                  }
                : prev
            );
          }
        }
      } catch (e) {
        if (!cancelled) {
          setReviewsError(e.message || "Ошибка загрузки отзывов");
          setReviews([]);
        }
      } finally {
        if (!cancelled) {
          setReviewsLoading(false);
        }
      }
    };

    loadReviews();

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
      // если URL начинается с /photos/... — это лежит на API , а не на Vite (5173)
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

  const userOwnReview = user
    ? reviews.find((review) => isSameUser(review, user)) || null
    : null;
  const userIsAdmin = user?.login === "admin";
  const canCreateReview = Boolean(user) && (userIsAdmin || !userOwnReview);

  const handleReviewButtonClick = () => {
    if (!user) {
      navigate("/login");
      return;
    }

    if (!canCreateReview && userOwnReview) {
      setReviewActionError("У вас уже есть отзыв на это место. Вы можете его редактировать.");
      setSubmitMessage("");
      setIsReviewFormOpen(false);
      startReviewEdit(userOwnReview);
      return;
    }

    setReviewActionError("");
    setSubmitMessage("");
    setIsReviewFormOpen(true);
  };

  const handleReviewImageFiles = (filesList) => {
    const files = Array.from(filesList || []);
    if (!files.length) return;

    setReviewImageError("");

    setReviewImages((prev) => {
      const remaining = REVIEW_IMAGES_LIMIT - prev.length;
      if (remaining <= 0) {
        setReviewImageError(`Можно добавить до ${REVIEW_IMAGES_LIMIT} фото`);
        return prev;
      }

      const nextFiles = files.slice(0, remaining);
      if (nextFiles.length < files.length) {
        setReviewImageError(`Можно добавить до ${REVIEW_IMAGES_LIMIT} фото`);
      }

      const newItems = nextFiles.map((file, idx) => ({
        id: `review-${Date.now()}-${idx}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));

      return [...prev, ...newItems];
    });
  };

  const handleReviewImageInputChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      handleReviewImageFiles(event.target.files);
      event.target.value = "";
    }
  };

  const handleReviewImageDrop = (event) => {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      handleReviewImageFiles(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  };

  const handleReviewImageRemove = (id) => {
    setReviewImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((img) => img.id !== id);
    });
    setReviewImageError("");
  };

  const uploadReviewImages = async (images) => {
    const files = (images || []).map((img) => img.file).filter(Boolean);
    if (!files.length) return [];

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.message || "Не удалось загрузить фото");
    }

    return data.urls || [];
  };

  const startReviewEdit = (review) => {
    const ratingValue = Number(review?.rating);
    const safeRating = Number.isFinite(ratingValue)
      ? Math.min(5, Math.max(1, Math.round(ratingValue)))
      : 5;
    const now = Date.now();
    const existingImages = Array.isArray(review?.images)
      ? review.images
          .filter((item) => typeof item === "string" && item.trim())
          .slice(0, REVIEW_IMAGES_LIMIT)
      : [];

    clearEditReviewImages();
    setEditingReviewId(review.id);
    setEditReviewText(review.text || "");
    setEditReviewRating(safeRating);
    setEditReviewImages(
      existingImages.map((url, index) => ({
        id: `review-edit-existing-${review.id}-${index}-${now}`,
        url,
        file: null,
        isNew: false,
        previewUrl: resolveMediaUrl(url),
      }))
    );
    setEditReviewImageError("");
    setEditReviewError("");
    setReviewActionError("");
    setSubmitMessage("");
  };

  const cancelReviewEdit = () => {
    clearEditReviewImages();
    setEditingReviewId(null);
    setEditReviewText("");
    setEditReviewRating(5);
    setEditReviewImageError("");
    setEditReviewError("");
  };

  const handleEditReviewImageFiles = (filesList) => {
    const files = Array.from(filesList || []);
    if (!files.length) return;

    setEditReviewImageError("");

    setEditReviewImages((prev) => {
      const remaining = REVIEW_IMAGES_LIMIT - prev.length;
      if (remaining <= 0) {
        setEditReviewImageError(`Можно добавить до ${REVIEW_IMAGES_LIMIT} фото`);
        return prev;
      }

      const nextFiles = files.slice(0, remaining);
      if (nextFiles.length < files.length) {
        setEditReviewImageError(`Можно добавить до ${REVIEW_IMAGES_LIMIT} фото`);
      }

      const newItems = nextFiles.map((file, idx) => ({
        id: `review-edit-${Date.now()}-${idx}`,
        url: null,
        file,
        isNew: true,
        previewUrl: URL.createObjectURL(file),
      }));

      return [...prev, ...newItems];
    });
  };

  const handleEditReviewImageInputChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      handleEditReviewImageFiles(event.target.files);
      event.target.value = "";
    }
  };

  const handleEditReviewImageDrop = (event) => {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      handleEditReviewImageFiles(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  };

  const handleEditReviewImageRemove = (id) => {
    setEditReviewImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target?.file && target.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((img) => img.id !== id);
    });
    setEditReviewImageError("");
  };

  const handleReviewUpdate = async (reviewId) => {
    if (!user) {
      navigate("/login");
      return;
    }

    const textValue = editReviewText.trim();
    const ratingValue = Number(editReviewRating);

    if (!textValue) {
      setEditReviewError("Добавьте текст отзыва");
      return;
    }

    if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
      setEditReviewError("Оценка должна быть от 1 до 5");
      return;
    }

    setEditReviewSaving(true);
    setEditReviewError("");
    setEditReviewImageError("");
    setReviewActionError("");

    try {
      const existingImageUrls = editReviewImages
        .filter(
          (img) =>
            !img?.isNew && typeof img?.url === "string" && img.url.trim()
        )
        .map((img) => img.url.trim());
      const uploadedUrls = await uploadReviewImages(
        editReviewImages.filter((img) => img?.isNew && img.file)
      );
      const nextImages = [...existingImageUrls, ...uploadedUrls].slice(
        0,
        REVIEW_IMAGES_LIMIT
      );

      const res = await fetch(
        `${API_BASE}/api/places/${placeId}/reviews/${reviewId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: textValue,
            rating: ratingValue,
            images: nextImages,
            userId: user.id,
            userLogin: user.login,
          }),
        }
      );

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.message || "Не удалось сохранить отзыв");
      }

      if (data.review) {
        setReviews((prev) =>
          prev.map((review) =>
            review.id === reviewId ? data.review : review
          )
        );
      }

      if (data.stats) {
        setPlace((prev) =>
          prev
            ? {
                ...prev,
                rating:
                  data.stats.average === undefined
                    ? prev.rating
                    : data.stats.average,
                reviews:
                  data.stats.count === undefined
                    ? prev.reviews
                    : data.stats.count,
              }
            : prev
        );
      }

      cancelReviewEdit();
    } catch (e) {
      setEditReviewError(e.message || "Не удалось сохранить отзыв");
    } finally {
      setEditReviewSaving(false);
    }
  };

  const handleReviewDelete = async (reviewId) => {
    if (!user) {
      navigate("/login");
      return;
    }

    const ok = window.confirm("Удалить этот отзыв?");
    if (!ok) return;

    setReviewDeletingId(reviewId);
    setReviewActionError("");

    try {
      const res = await fetch(
        `${API_BASE}/api/places/${placeId}/reviews/${reviewId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: user.id,
            userLogin: user.login,
          }),
        }
      );

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.message || "Не удалось удалить отзыв");
      }

      setReviews((prev) => prev.filter((review) => review.id !== reviewId));

      if (data.stats) {
        setPlace((prev) =>
          prev
            ? {
                ...prev,
                rating:
                  data.stats.average === undefined
                    ? prev.rating
                    : data.stats.average,
                reviews:
                  data.stats.count === undefined
                    ? prev.reviews
                    : data.stats.count,
              }
            : prev
        );
      }

      if (editingReviewId === reviewId) {
        cancelReviewEdit();
      }
    } catch (e) {
      setReviewActionError(e.message || "Не удалось удалить отзыв");
    } finally {
      setReviewDeletingId(null);
    }
  };

  const handleReviewSubmit = async (event) => {
    event.preventDefault();

    if (!user) {
      navigate("/login");
      return;
    }

    if (!canCreateReview) {
      setReviewActionError("У вас уже есть отзыв на это место. Вы можете его редактировать.");
      setSubmitMessage("");
      if (userOwnReview) {
        setIsReviewFormOpen(false);
        startReviewEdit(userOwnReview);
      }
      return;
    }

    const text = reviewText.trim();
    const ratingValue = Number(reviewRating);

    if (!text) {
      setSubmitMessage("Добавьте текст отзыва");
      return;
    }

    if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
      setSubmitMessage("Оценка должна быть от 1 до 5");
      return;
    }

    setReviewSubmitting(true);
    setSubmitMessage("");

    try {
      const uploadedUrls = await uploadReviewImages(reviewImages);
      const payload = {
        userId: user.id,           // ✅ важно
        userLogin: user.login,     // можно оставить как fallback
        text,
        rating: ratingValue,
        images: uploadedUrls,
      };

      const res = await fetch(`${API_BASE}/api/places/${placeId}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.message || "Не удалось отправить отзыв");
      }

      if (data.review) {
        setReviews((prev) => [data.review, ...prev]);
      }

      if (data.stats) {
        setPlace((prev) =>
          prev
            ? {
                ...prev,
                rating:
                  data.stats.average === undefined
                    ? prev.rating
                    : data.stats.average,
                reviews:
                  data.stats.count === undefined
                    ? prev.reviews
                    : data.stats.count,
              }
            : prev
        );
      }

      setReviewText("");
      setReviewRating(5);
      clearReviewImages();
      setReviewImageError("");
      setSubmitMessage("Отзыв отправлен");
      setIsReviewFormOpen(true);
    } catch (e) {
      setSubmitMessage(e.message || "Не удалось отправить отзыв");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const ratingSource =
    typeof place.rating === "number" && !Number.isNaN(place.rating)
      ? place.rating
      : reviews.length
      ? reviews.reduce((acc, r) => acc + Number(r.rating || 0), 0) / reviews.length
      : null;

  const hasRating =
    typeof ratingSource === "number" && !Number.isNaN(ratingSource);
  const ratingValue = hasRating ? ratingSource.toFixed(1) : "-";
  const reviewsCount = place.reviews ?? reviews.length ?? 0;
  const submitSuccessText = "Отзыв отправлен";
  const isSubmitError = submitMessage && submitMessage !== submitSuccessText;
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
                  <h2 className="place-page__section-title">{"Отзывы"}</h2>
                  <button
                    type="button"
                    className="place-page__reviews-btn"
                    onClick={handleReviewButtonClick}
                  >
                    {user && !userIsAdmin && userOwnReview
                      ? "Редактировать мой отзыв"
                      : "Оставить отзыв"}
                  </button>
                </div>

                {isReviewFormOpen && canCreateReview && (
                  <form className="review-form" onSubmit={handleReviewSubmit}>
                    <div className="review-form__row">
                      <span className="review-form__label">{"Ваша оценка:"}</span>
                      <div className="review-form__stars">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={
                              "review-form__star" +
                              (value <= reviewRating
                                ? " review-form__star--active"
                                : "")
                            }
                            onClick={() => setReviewRating(value)}
                          >
                            ★
                          </button>
                        ))}
                        <span className="review-form__hint">{reviewRating}/5</span>
                      </div>
                    </div>

                    <textarea
                      className="review-form__textarea"
      placeholder="Расскажите о впечатлениях"
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
                      rows={3}
                      maxLength={1000}
                    />

                    <div className="review-form__uploads">
                      <div className="review-form__uploads-title">
                        Фото к отзыву (до {REVIEW_IMAGES_LIMIT})
                      </div>

                      <div className="review-form__uploads-grid">
                        {reviewImages.map((img) => (
                          <div key={img.id} className="review-form__upload-thumb">
                            <img
                              src={img.previewUrl}
                              alt="Фото отзыва"
                              className="review-form__upload-img"
                            />
                            <button
                              type="button"
                              className="review-form__upload-remove"
                              onClick={() => handleReviewImageRemove(img.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))}

                        <label
                          className="review-form__upload"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={handleReviewImageDrop}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="review-form__upload-input"
                            onChange={handleReviewImageInputChange}
                          />
                          <div className="review-form__upload-icon">+</div>
                          <div className="review-form__upload-text">Добавить</div>
                        </label>
                      </div>

                      {reviewImageError && (
                        <div className="review-form__message review-form__message--error">
                          {reviewImageError}
                        </div>
                      )}
                    </div>

                    <div className="review-form__actions">
                      <button
                        type="submit"
                        className="review-form__submit"
                        disabled={reviewSubmitting}
                      >
                        {reviewSubmitting ? "Отправляем..." : "Опубликовать"}
                      </button>

                      {submitMessage && (
                        <span
                          className={
                            "review-form__message" +
                            (isSubmitError ? " review-form__message--error" : "")
                          }
                        >
                          {submitMessage}
                        </span>
                      )}
                    </div>
                  </form>
                )}

                {reviewsError && (
                  <p className="review-form__message review-form__message--error">
                    {reviewsError}
                  </p>
                )}

                {reviewActionError && !reviewsError && (
                  <p className="review-form__message review-form__message--error">
                    {reviewActionError}
                  </p>
                )}

                {reviewsLoading ? (
                  <p>Загружаем отзывы...</p>
                ) : (
                  <div className="place-page__reviews-list">
                    {reviews.map((review) => {
                      const displayName = review.userName || review.userLogin || "Гость";
                      const initials = getInitials(displayName);
                      const safeRating = Math.max(
                        0,
                        Math.min(5, Number(review.rating) || 0)
                      );
                      const reviewDate = formatReviewDate(review.createdAt);
                      const canEditReview =
                        user && (user.login === "admin" || isSameUser(review, user));
                      const canDeleteReview = user && user.login === "admin";
                      const isEditing = editingReviewId === review.id;

                      return (
                        <article key={review.id} className="review-card">
                          <div className="review-card__header">
                            <div className="review-card__user">
                              <div className="review-card__avatar">
                                {review.userAvatar ? (
                                  <img
                                    src={review.userAvatar}
                                    alt={displayName}
                                    className="review-card__avatar-img"
                                    onError={(e) => {
                                      // если картинка не загрузилась — покажем инициалы
                                      e.currentTarget.style.display = "none";
                                    }}
                                  />
                                ) : (
                                  initials
                                )}
                              </div>
                              <div>
                                <div className="review-card__name">
                                  {displayName}
                                </div>
                                {review.userLogin && (
                                  <div className="review-card__role">
                                    {review.userLogin}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="review-card__meta">
                              <div className="review-card__stars">
                                {"★".repeat(safeRating)}
                                {"☆".repeat(5 - safeRating)}
                              </div>
                              <div className="review-card__date">
                                {reviewDate || "Сегодня"}
                              </div>
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="review-card__edit">
                              <div className="review-card__edit-row">
                                <span className="review-card__edit-label">
                                  Оценка:
                                </span>
                                <div className="review-card__edit-stars">
                                  {[1, 2, 3, 4, 5].map((value) => (
                                    <button
                                      key={value}
                                      type="button"
                                      className={
                                        "review-card__edit-star" +
                                        (value <= editReviewRating
                                          ? " review-card__edit-star--active"
                                          : "")
                                      }
                                      onClick={() => {
                                        setEditReviewRating(value);
                                        setEditReviewError("");
                                      }}
                                    >
                                      ★
                                    </button>
                                  ))}
                                  <span className="review-card__edit-hint">
                                    {editReviewRating}/5
                                  </span>
                                </div>
                              </div>

                              <textarea
                                className="review-card__edit-textarea"
                                value={editReviewText}
                                onChange={(e) => {
                                  setEditReviewText(e.target.value);
                                  setEditReviewError("");
                                }}
                                rows={3}
                                maxLength={1000}
                              />

                              <div className="review-form__uploads">
                                <div className="review-form__uploads-title">
                                  Фото к отзыву (до {REVIEW_IMAGES_LIMIT})
                                </div>

                                <div className="review-form__uploads-grid">
                                  {editReviewImages.map((img) => (
                                    <div key={img.id} className="review-form__upload-thumb">
                                      <img
                                        src={img.isNew ? img.previewUrl : resolveMediaUrl(img.url)}
                                        alt="Фото отзыва"
                                        className="review-form__upload-img"
                                      />
                                      <button
                                        type="button"
                                        className="review-form__upload-remove"
                                        onClick={() => handleEditReviewImageRemove(img.id)}
                                        disabled={editReviewSaving}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}

                                  {editReviewImages.length < REVIEW_IMAGES_LIMIT && (
                                    <label
                                      className="review-form__upload"
                                      onDragOver={(e) => e.preventDefault()}
                                      onDrop={handleEditReviewImageDrop}
                                    >
                                      <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="review-form__upload-input"
                                        onChange={handleEditReviewImageInputChange}
                                      />
                                      <div className="review-form__upload-icon">+</div>
                                      <div className="review-form__upload-text">Добавить</div>
                                    </label>
                                  )}
                                </div>
                              </div>

                              {editReviewImageError && (
                                <div className="review-card__edit-message review-card__edit-message--error">
                                  {editReviewImageError}
                                </div>
                              )}

                              {editReviewError && (
                                <div className="review-card__edit-message review-card__edit-message--error">
                                  {editReviewError}
                                </div>
                              )}

                              <div className="review-card__edit-actions">
                                <button
                                  type="button"
                                  className="review-card__edit-btn"
                                  onClick={() => handleReviewUpdate(review.id)}
                                  disabled={editReviewSaving}
                                >
                                  {editReviewSaving ? "Сохраняем..." : "Сохранить"}
                                </button>
                                <button
                                  type="button"
                                  className="review-card__edit-btn review-card__edit-btn--ghost"
                                  onClick={cancelReviewEdit}
                                  disabled={editReviewSaving}
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="review-card__text">{review.text}</p>
                          )}

                          {!isEditing && Array.isArray(review.images) && review.images.length > 0 && (
                            <div className="review-card__images">
                              {review.images.map((img, index) => (
                                <img
                                  key={`${review.id}-img-${index}`}
                                  src={resolveMediaUrl(img)}
                                  alt={`Фото отзыва ${index + 1}`}
                                  className="review-card__image"
                                />
                              ))}
                            </div>
                          )}

                          {canEditReview && !isEditing && (
                            <div className="review-card__actions">
                              <button
                                type="button"
                                className="review-card__action-btn"
                                onClick={() => startReviewEdit(review)}
                              >
                                Редактировать
                              </button>
                              {canDeleteReview && (
                                <button
                                  type="button"
                                  className="review-card__action-btn review-card__action-btn--danger"
                                  onClick={() => handleReviewDelete(review.id)}
                                  disabled={reviewDeletingId === review.id}
                                >
                                  {reviewDeletingId === review.id
                                    ? "Удаляем..."
                                    : "Удалить"}
                                </button>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}

                    {reviews.length === 0 && !reviewsError && (
                      <p>
                        Пока нет отзывов. Будьте первым, кто поделится
                        впечатлениями!
                      </p>
                    )}
                  </div>
                )}
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

