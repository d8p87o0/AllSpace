// src/Admin.jsx
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "/api" : "http://localhost:3001");

function resolveMediaUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/photos/") || url.startsWith("/avatars/")) {
    return `${API_BASE}${url}`;
  }
  return url;
}

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
  hours: "", 
  phone: "", 
};

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

function normalizeReviewDraft(review) {
  const ratingValue = Number(review?.rating);
  const safeRating = Number.isFinite(ratingValue)
    ? Math.min(5, Math.max(1, Math.round(ratingValue)))
    : 5;

  return {
    ...review,
    draftText: review?.text || "",
    draftRating: safeRating,
  };
}

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
  const [pendingPlaces, setPendingPlaces] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null); // место для поп-апа удаления
  const [placeReviews, setPlaceReviews] = useState([]);
  const [placeReviewsLoading, setPlaceReviewsLoading] = useState(false);
  const [placeReviewsError, setPlaceReviewsError] = useState("");
  const [reviewSavingId, setReviewSavingId] = useState(null);
  const [reviewDeletingId, setReviewDeletingId] = useState(null);

  // === images: отдельное состояние для картинок выбранного места ===
  /**
   * editImages: массив объектов вида
   * { id, url, order, toDelete, isNew, file, previewUrl }
   */
  const [editImages, setEditImages] = useState([]);
  // === images: для создания нового места ===
  const [createImages, setCreateImages] = useState([]);
  const placesListRef = useRef(null);
  // Флаг, чтобы восстановить выбор после загрузки только один раз
  const selectionRestoredRef = useRef(false);
  // помощник: собрать картинки для редактирования

  const buildImagesForEdit = (place, photos = []) => {
    // 1) приоритет — photos из /api/places/:id/photos
    // 2) потом place.images (что сохранили через админку ранее)
    // 3) потом одиночное поле image
    const base =
      (Array.isArray(photos) && photos.length)
        ? photos
        : (place.images && Array.isArray(place.images) && place.images.length)
        ? place.images
        : place.image
        ? [place.image]
        : [];

    return base.map((url, index) => ({
      id: `${place.id || "place"}-${index}`,
      url,
      order: index + 1,
      toDelete: false,
      isNew: false,
      file: null,
      previewUrl: null,
    }));
  };

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

  const loadPendingPlaces = async () => {
    setPendingLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/places?status=pending`);
      const data = await res.json();
      if (data.ok) {
        setPendingPlaces(data.places || []);
      } else {
        setPendingPlaces([]);
      }
    } catch (e) {
      console.error("Ошибка загрузки мест на модерации:", e);
      setPendingPlaces([]);
    } finally {
      setPendingLoading(false);
    }
  };

  const loadPlaceReviews = async (placeId) => {
    if (!placeId) {
      setPlaceReviews([]);
      setPlaceReviewsError("");
      return;
    }

    setPlaceReviewsLoading(true);
    setPlaceReviewsError("");

    try {
      const res = await fetch(`${API_BASE}/api/places/${placeId}/reviews`);
      const data = await res.json();
      if (!data.ok) {
        setPlaceReviewsError(data.message || "Не удалось загрузить отзывы");
        setPlaceReviews([]);
        return;
      }

      const list = Array.isArray(data.reviews) ? data.reviews : [];
      setPlaceReviews(list.map((review) => normalizeReviewDraft(review)));
    } catch (e) {
      console.error("Ошибка загрузки отзывов для админки:", e);
      setPlaceReviewsError("Ошибка соединения с сервером");
      setPlaceReviews([]);
    } finally {
      setPlaceReviewsLoading(false);
    }
  };

  useEffect(() => {
    loadPlaces();
    loadPendingPlaces();
  }, []);

  useEffect(() => {
    if (!selectedPlaceId) {
      setPlaceReviews([]);
      setPlaceReviewsError("");
      return;
    }
    loadPlaceReviews(selectedPlaceId);
  }, [selectedPlaceId]);

  const selectedPlace =
    places.find((p) => p.id === selectedPlaceId) ||
    pendingPlaces.find((p) => p.id === selectedPlaceId) ||
    null;
  const selectedPlaceStatus = selectedPlace?.moderation_status || "approved";

  const approvePlace = async (placeId) => {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API_BASE}/api/places/${placeId}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || "Не удалось одобрить место");
        return;
      }
      setSuccess("Место одобрено");
      await loadPendingPlaces();
      await loadPendingPlaces();
      await loadPlaces();
    } catch (e) {
      console.error("Ошибка одобрения места:", e);
      setError("Ошибка соединения с сервером");
    }
  };

  const rejectPlace = async (placeId) => {
    const ok = window.confirm("Отклонить это место?");
    if (!ok) return;

    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API_BASE}/api/places/${placeId}/reject`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || "Не удалось отклонить место");
        return;
      }
      setSuccess("Место отклонено");
      await loadPendingPlaces();
    } catch (e) {
      console.error("Ошибка отклонения места:", e);
      setError("Ошибка соединения с сервером");
    }
  };

// после загрузки мест пробуем восстановить последнее выбранное место
  useEffect(() => {
    if (selectionRestoredRef.current) return;
    if (loading) return;
    if (!places.length) return;

    let storedId = null;
    try {
      storedId = localStorage.getItem("admin_selected_place_id");
    } catch (e) {
      console.error("Не удалось прочитать admin_selected_place_id:", e);
    }

    if (!storedId) return;
    const idNum = Number(storedId);
    if (!Number.isFinite(idNum)) return;

    const place = places.find((p) => p.id === idNum);
    if (!place) return;

    selectionRestoredRef.current = true;
    // логика выбора такая же, как при клике
    handleSelectPlace(place);
  }, [loading, places]);

  // скроллим список так, чтобы выбранное место было по центру
  useEffect(() => {
    if (!placesListRef.current || !selectedPlaceId) return;

    const container = placesListRef.current;
    const activeBtn = container.querySelector(".admin__place-btn--active");
    if (!activeBtn) return;

    try {
      activeBtn.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    } catch (e) {
      // fallback для старых браузеров
      activeBtn.scrollIntoView();
    }
  }, [places, selectedPlaceId]);

  // === images: работа с карточками (CREATE) ===

  const handleCreateImageOrderChange = (id, newOrder) => {
    setCreateImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, order: newOrder } : img))
    );
  };

  const markCreateImageForDelete = (id) => {
    setCreateImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, toDelete: true } : img))
    );
  };

  const undoCreateImageDelete = (id) => {
    setCreateImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, toDelete: false } : img))
    );
  };

  const handleCreateImageFiles = (filesList) => {
    const files = Array.from(filesList || []);
    if (!files.length) return;

    setCreateImages((prev) => {
      const maxOrder = prev.reduce(
        (max, img) => Math.max(max, Number(img.order || 0)),
        0
      );
      let currentOrder = maxOrder;

      const newItems = files.map((file, idx) => {
        currentOrder += 1;
        return {
          id: `create-new-${Date.now()}-${idx}`,
          url: "",
          order: currentOrder,
          toDelete: false,
          isNew: true,
          file,
          previewUrl: URL.createObjectURL(file),
        };
      });

      return [...prev, ...newItems];
    });
  };

  const handleCreateImageInputChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      handleCreateImageFiles(event.target.files);
      event.target.value = "";
    }
  };

  const handleCreateImageDrop = (event) => {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      handleCreateImageFiles(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  };


  const handleSelectPlace = async (place) => {
    setSelectedPlaceId(place.id);
  
    // запоминаем выбранное место, чтобы восстановить после перезагрузки
    try {
      localStorage.setItem("admin_selected_place_id", String(place.id));
    } catch (e) {
      console.error("Не удалось сохранить admin_selected_place_id:", e);
    }
  
    // текстовые поля
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
      hours: place.hours || "",
      phone: place.phone || "",
    });
  
    // пока грузим — очистим, чтобы не мигало старое
    setEditImages([]);
    setSuccess("");
    setError("");
  
    try {
      const res = await fetch(`${API_BASE}/api/places/${place.id}/photos`);
      const data = await res.json();
  
      if (data.ok && Array.isArray(data.photos) && data.photos.length) {
        // фотки с бэка (скан папки /photos/...)
        setEditImages(buildImagesForEdit(place, data.photos));
      } else {
        // fallback: только image / images из самого place
        setEditImages(buildImagesForEdit(place, []));
      }
    } catch (e) {
      console.error("Ошибка загрузки фото для редактирования:", e);
      setEditImages(buildImagesForEdit(place, []));
    }
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

  // === images: работа с карточками ===

  const handleImageOrderChange = (id, newOrder) => {
    setEditImages((prev) =>
      prev.map((img) =>
        img.id === id ? { ...img, order: newOrder } : img
      )
    );
  };

  const markImageForDelete = (id) => {
    setEditImages((prev) =>
      prev.map((img) =>
        img.id === id ? { ...img, toDelete: true } : img
      )
    );
  };

  const undoImageDelete = (id) => {
    setEditImages((prev) =>
      prev.map((img) =>
        img.id === id ? { ...img, toDelete: false } : img
      )
    );
  };

  const handleImageFiles = (filesList) => {
    const files = Array.from(filesList || []);
    if (!files.length) return;

    setEditImages((prev) => {
      const maxOrder = prev.reduce(
        (max, img) => Math.max(max, Number(img.order || 0)),
        0
      );
      let currentOrder = maxOrder;

      const newItems = files.map((file, idx) => {
        currentOrder += 1;
        return {
          id: `new-${Date.now()}-${idx}`,
          url: "", // зададим после загрузки на сервер
          order: currentOrder,
          toDelete: false,
          isNew: true,
          file,
          previewUrl: URL.createObjectURL(file),
        };
      });

      return [...prev, ...newItems];
    });
  };

  const handleImageInputChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      handleImageFiles(event.target.files);
      // сброс, чтобы повторный выбор с теми же файлами тоже срабатывал
      event.target.value = "";
    }
  };

  const handleImageDrop = (event) => {
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      handleImageFiles(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  };

  // helper: загрузка новых файлов на сервер
  // helper: загрузка новых файлов на сервер (универсально для edit/create)
  const uploadNewImages = async (images) => {
    const newImages = (images || []).filter(
      (img) => img.isNew && img.file && !img.toDelete
    );
    if (!newImages.length) return [];

    const formData = new FormData();
    newImages.forEach((img) => formData.append("files", img.file));

    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Не удалось загрузить изображения");

    return data.urls || [];
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!selectedPlaceId) return;

    setError("");
    setSuccess("");

    try {
      // 1) Загружаем все новые картинки (isNew)
      const uploadedUrls = await uploadNewImages(editImages);
      let uploadIndex = 0;

      // 2) Формируем финальный список картинок без помеченных на удаление
      const finalImages = editImages
        .filter((img) => !img.toDelete)
        .map((img) => {
          if (img.isNew) {
            const url = uploadedUrls[uploadIndex++];
            return { ...img, url };
          }
          return img;
        })
        .filter((img) => img.url); // только те, у кого есть url

      finalImages.sort(
        (a, b) => Number(a.order || 0) - Number(b.order || 0)
      );

      const imagesForServer = finalImages.map((img) => img.url);

      const body = {
        name: editForm.name.trim(),
        type: editForm.type.trim(),
        city: editForm.city.trim(),
        address: editForm.address.trim(),
        // главная картинка — первая по порядку, если есть
        image: imagesForServer[0] || editForm.image.trim(),
        // новый массив картинок (для галереи)
        images: imagesForServer,
        badge: editForm.badge.trim(),
        rating: editForm.rating ? Number(editForm.rating) : null,
        reviews: editForm.reviews ? Number(editForm.reviews) : null,
        features: parseFeatures(editForm.featuresText),
        link: editForm.link.trim(),
        hours: editForm.hours.trim() || null,
        phone: editForm.phone.trim() || null,
      };

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
        // обновим форму и картинки свежими данными
        handleSelectPlace(data.place);
      }
    } catch (e) {
      console.error("Ошибка обновления места:", e);
      setError(e.message || "Ошибка соединения с сервером");
    }
  };

  const submitCreate = async (event) => {
    event.preventDefault();
  
    setError("");
    setSuccess("");
  
    try {
      const nameValue = createForm.name.trim();
      const cityValue = createForm.city.trim();
      const addressValue = createForm.address.trim();
      const imageValue = createForm.image.trim();
      const hasImages = createImages.some((img) => !img.toDelete);

      if (!nameValue || !cityValue || !addressValue) {
        setError("Название, город и адрес обязательны.");
        return;
      }

      if (!imageValue && !hasImages) {
        setError("Нужно добавить хотя бы одно фото.");
        return;
      }

      // 1) Загружаем выбранные фото (если есть)
      const uploadedUrls = await uploadNewImages(createImages);
      let uploadIndex = 0;
  
      // 2) Собираем финальный список картинок
      const finalImages = createImages
        .filter((img) => !img.toDelete)
        .map((img) => {
          if (img.isNew) {
            const url = uploadedUrls[uploadIndex++];
            return { ...img, url };
          }
          return img;
        })
        .filter((img) => img.url);
  
      finalImages.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      const imagesForServer = finalImages.map((img) => img.url);
  
      // 3) Формируем body
      const body = {
        name: nameValue,
        type: createForm.type.trim(),
        city: cityValue,
        address: addressValue,
  
        // главная картинка — первая загруженная, иначе то, что ввели вручную
        image: imagesForServer[0] || imageValue,
        images: imagesForServer, // галерея
  
        badge: createForm.badge.trim(),
        rating: createForm.rating ? Number(createForm.rating) : null,
        reviews: createForm.reviews ? Number(createForm.reviews) : null,
        features: parseFeatures(createForm.featuresText),
        link: createForm.link.trim(),
        hours: createForm.hours.trim() || null,
        phone: createForm.phone.trim() || null,
      };
  
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
      setCreateImages([]);
      await loadPlaces();
    } catch (e) {
      console.error("Ошибка добавления места:", e);
      setError(e.message || "Ошибка соединения с сервером");
    }
  };

  const handleReviewDraftChange = (reviewId, field, value) => {
    setPlaceReviews((prev) =>
      prev.map((review) =>
        review.id === reviewId ? { ...review, [field]: value } : review
      )
    );
  };

  const handleReviewReset = (reviewId) => {
    setPlaceReviews((prev) =>
      prev.map((review) =>
        review.id === reviewId
          ? normalizeReviewDraft(review)
          : review
      )
    );
  };

  const handleReviewSave = async (review) => {
    if (!selectedPlaceId) return;

    const textValue = String(review.draftText || "").trim();
    const ratingValue = Number(review.draftRating);

    if (!textValue) {
      setPlaceReviewsError("Текст отзыва обязателен");
      return;
    }

    if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
      setPlaceReviewsError("Оценка должна быть от 1 до 5");
      return;
    }

    setPlaceReviewsError("");
    setReviewSavingId(review.id);

    try {
      const res = await fetch(
        `${API_BASE}/api/places/${selectedPlaceId}/reviews/${review.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: textValue,
            rating: ratingValue,
            userId: user?.id ?? null,
            userLogin: user?.login ?? null,
          }),
        }
      );

      const data = await res.json();
      if (!data.ok) {
        setPlaceReviewsError(data.message || "Не удалось сохранить отзыв");
        return;
      }

      if (data.review) {
        setPlaceReviews((prev) =>
          prev.map((item) =>
            item.id === review.id ? normalizeReviewDraft(data.review) : item
          )
        );
      }

      await loadPlaces();
    } catch (e) {
      console.error("Ошибка обновления отзыва:", e);
      setPlaceReviewsError("Ошибка соединения с сервером");
    } finally {
      setReviewSavingId(null);
    }
  };

  const handleReviewDelete = async (reviewId) => {
    if (!selectedPlaceId) return;
    const ok = window.confirm("Удалить этот отзыв?");
    if (!ok) return;

    setPlaceReviewsError("");
    setReviewDeletingId(reviewId);

    try {
      const res = await fetch(
        `${API_BASE}/api/places/${selectedPlaceId}/reviews/${reviewId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user?.id ?? null,
            userLogin: user?.login ?? null,
          }),
        }
      );

      const data = await res.json();
      if (!data.ok) {
        setPlaceReviewsError(data.message || "Не удалось удалить отзыв");
        return;
      }

      setPlaceReviews((prev) => prev.filter((review) => review.id !== reviewId));
      await loadPlaces();
    } catch (e) {
      console.error("Ошибка удаления отзыва:", e);
      setPlaceReviewsError("Ошибка соединения с сервером");
    } finally {
      setReviewDeletingId(null);
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
        setEditImages([]);
        // убираем сохранённый id из localStorage
        try {
          localStorage.removeItem("admin_selected_place_id");
        } catch (e) {
          console.error("Не удалось удалить admin_selected_place_id:", e);
        }
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
            <p className="admin__subtitle">Управление местами для каталога</p>
          </div>

          <div className="admin__header-actions">
          <button
            type="button"
            className="admin__back-btn"
            onClick={goToSite}
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

        {error && (
          <div className="admin__alert admin__alert--error">{error}</div>
        )}
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
              <div className="admin__places-list" ref={placesListRef}>
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

            {selectedPlace && (
              <button
                type="button"
                className="admin__delete-btn"
                onClick={() => {
                  setDeleteTarget(selectedPlace);
                }}
              >
                Удалить выбранное место
              </button>
            )}
          </aside>

          {/* ПРАВАЯ КОЛОНКА: формы */}
          <div className="admin__content">
            {/* Модерация */}
            <div className="admin__card">
              <h2 className="admin__card-title">Модерация</h2>
              {pendingLoading ? (
                <p className="admin__hint">Загружаем заявки...</p>
              ) : pendingPlaces.length === 0 ? (
                <p className="admin__hint">Нет мест на модерации</p>
              ) : (
                <div className="admin__moderation-list">
                  {pendingPlaces.map((place) => (
                    <div key={place.id} className="admin__moderation-item">
                      <div className="admin__moderation-info">
                        <span className="admin__moderation-name">{place.name}</span>
                        <span className="admin__moderation-meta">
                          {[place.city, place.address].filter(Boolean).join(" • ")}
                        </span>
                        {place.submitted_by && (
                          <span className="admin__moderation-meta">
                            Отправил: {place.submitted_by}
                          </span>
                        )}
                      </div>
                      <div className="admin__moderation-actions">
                        <button
                          type="button"
                          className="admin__moderation-open"
                          onClick={() => handleSelectPlace(place)}
                        >
                          Открыть
                        </button>
                        <button
                          type="button"
                          className="admin__moderation-approve"
                          onClick={() => approvePlace(place.id)}
                        >
                          Одобрить
                        </button>
                        <button
                          type="button"
                          className="admin__moderation-reject"
                          onClick={() => rejectPlace(place.id)}
                        >
                          Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Форма редактирования */}
            <div className="admin__card">
              <h2 className="admin__card-title">Редактирование места</h2>
              {selectedPlaceId && selectedPlaceStatus === "pending" && (
                <div className="admin__moderation-status">Статус: на модерации</div>
              )}
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
                      required
                    />
                    <input
                      type="text"
                      name="address"
                      className="admin-input"
                      placeholder="Адрес"
                      value={editForm.address}
                      onChange={handleEditChange}
                      required
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
                    <input
                      type="text"
                      name="phone"
                      className="admin-input"
                      placeholder="Телефон (например: +7 999 123-45-67)"
                      value={editForm.phone}
                      onChange={handleEditChange}
                    />

                    <input
                      type="text"
                      name="hours"
                      className="admin-input"
                      placeholder="График работы (например: Пн–Пт 09:00–21:00)"
                      value={editForm.hours}
                      onChange={handleEditChange}
                    />
                  </div>

                  {/* === Блок картинок === */}
                  <div className="admin-images">
                    <div className="admin-images__header">
                      <span>Фотографии</span>
                      <span className="admin-images__hint">
                        Перетаскивай, кликай, меняй порядок
                      </span>
                    </div>

                    <div className="admin-images__grid">
                      {editImages.map((img) => {
                        const preview = img.previewUrl || img.url;
                        if (!preview) return null;
                        return (
                          <div
                            key={img.id}
                            className={
                              "admin-image-card" +
                              (img.toDelete
                                ? " admin-image-card--deleted"
                                : "")
                            }
                          >
                            <div className="admin-image-card__thumb-wrap">
                          <img
                            src={resolveMediaUrl(preview)}
                            alt=""
                            className="admin-image-card__thumb"
                          />

                              <div className="admin-image-card__index-badge">
                                <input
                                  type="number"
                                  min="1"
                                  className="admin-image-card__index-input"
                                  value={img.order ?? ""}
                                  onChange={(e) =>
                                    handleImageOrderChange(
                                      img.id,
                                      Number(e.target.value) || 1
                                    )
                                  }
                                />
                              </div>

                              {!img.toDelete && (
                                <button
                                  type="button"
                                  className="admin-image-card__remove"
                                  onClick={() =>
                                    markImageForDelete(img.id)
                                  }
                                >
                                  ×
                                </button>
                              )}
                            </div>

                            {img.toDelete && (
                              <button
                                type="button"
                                className="admin-image-card__undo"
                                onClick={() => undoImageDelete(img.id)}
                              >
                                Отменить удаление
                              </button>
                            )}

                            {!img.isNew && (
                              <div
                                className="admin-image-card__path"
                                title={img.url}
                              >
                                {img.url}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Карточка добавления новых фото */}
                      <label
                        className="admin-image-add"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleImageDrop}
                      >
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="admin-image-add__input"
                          onChange={handleImageInputChange}
                        />
                        <div className="admin-image-add__icon">+</div>
                        <div className="admin-image-add__text">
                          Перетащите фото или нажмите, чтобы выбрать
                        </div>
                      </label>
                    </div>
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

            {/* Отзывы места */}
            <div className="admin__card">
              <h2 className="admin__card-title">Отзывы места</h2>
              {!selectedPlaceId ? (
                <p className="admin__hint">
                  Выберите место, чтобы управлять отзывами.
                </p>
              ) : (
                <div className="admin-reviews">
                  <div className="admin-reviews__header">
                    <div className="admin-reviews__count">
                      Всего: {placeReviews.length}
                    </div>
                    <button
                      type="button"
                      className="admin-reviews__refresh"
                      onClick={() => loadPlaceReviews(selectedPlaceId)}
                      disabled={placeReviewsLoading}
                    >
                      Обновить
                    </button>
                  </div>

                  {placeReviewsError && (
                    <div className="admin__alert admin__alert--error">
                      {placeReviewsError}
                    </div>
                  )}

                  {placeReviewsLoading ? (
                    <p className="admin__hint">Загружаем отзывы...</p>
                  ) : placeReviews.length ? (
                    <div className="admin-reviews__list">
                      {placeReviews.map((review) => {
                        const displayName =
                          review.userName || review.userLogin || "Гость";
                        const reviewDate = formatReviewDate(review.createdAt);
                        const metaParts = [];
                        if (review.userLogin) metaParts.push(`@${review.userLogin}`);
                        if (reviewDate) metaParts.push(reviewDate);

                        return (
                          <div key={review.id} className="admin-review">
                            <div className="admin-review__header">
                              <div>
                                <div className="admin-review__name">
                                  {displayName}
                                </div>
                                {metaParts.length > 0 && (
                                  <div className="admin-review__meta">
                                    {metaParts.join(" · ")}
                                  </div>
                                )}
                              </div>
                              <div className="admin-review__rating">
                                <input
                                  type="number"
                                  min="1"
                                  max="5"
                                  className="admin-input admin-review__rating-input"
                                  value={review.draftRating}
                                  onChange={(e) =>
                                    handleReviewDraftChange(
                                      review.id,
                                      "draftRating",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>
                            </div>

                            <textarea
                              className="admin-textarea admin-review__text"
                              value={review.draftText}
                              onChange={(e) =>
                                handleReviewDraftChange(
                                  review.id,
                                  "draftText",
                                  e.target.value
                                )
                              }
                              rows={3}
                            />

                            {Array.isArray(review.images) &&
                              review.images.length > 0 && (
                                <div className="admin-review__images">
                                  {review.images.map((img, index) => (
                                    <img
                                      key={`${review.id}-img-${index}`}
                                      src={resolveMediaUrl(img)}
                                      alt=""
                                      className="admin-review__image"
                                    />
                                  ))}
                                </div>
                              )}

                            <div className="admin-review__actions">
                              <button
                                type="button"
                                className="admin-review__btn"
                                onClick={() => handleReviewSave(review)}
                                disabled={reviewSavingId === review.id}
                              >
                                {reviewSavingId === review.id
                                  ? "Сохраняем..."
                                  : "Сохранить"}
                              </button>
                              <button
                                type="button"
                                className="admin-review__btn admin-review__btn--ghost"
                                onClick={() => handleReviewReset(review.id)}
                                disabled={reviewSavingId === review.id}
                              >
                                Сбросить
                              </button>
                              <button
                                type="button"
                                className="admin-review__btn admin-review__btn--danger"
                                onClick={() => handleReviewDelete(review.id)}
                                disabled={reviewDeletingId === review.id}
                              >
                                {reviewDeletingId === review.id
                                  ? "Удаляем..."
                                  : "Удалить"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="admin__hint">Отзывов пока нет.</p>
                  )}
                </div>
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
                    required
                  />
                  <input
                    type="text"
                    name="address"
                    className="admin-input"
                    placeholder="Адрес"
                    value={createForm.address}
                    onChange={handleCreateChange}
                    required
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
                  <input
                    type="text"
                    name="phone"
                    className="admin-input"
                    placeholder="Телефон (например: +7 999 123-45-67)"
                    value={createForm.phone}
                    onChange={handleCreateChange}
                  />

                  <input
                    type="text"
                    name="hours"
                    className="admin-input"
                    placeholder="График работы (например: Пн–Пт 09:00–21:00)"
                    value={createForm.hours}
                    onChange={handleCreateChange}
                  />
                </div>
                {/* === Блок картинок (CREATE) === */}
                <div className="admin-images">
                  <div className="admin-images__header">
                    <span>Фотографии</span>
                    <span className="admin-images__hint">
                      Перетаскивай, кликай, меняй порядок
                    </span>
                  </div>

                  <div className="admin-images__grid">
                    {createImages.map((img) => {
                      const preview = img.previewUrl || img.url;
                      if (!preview) return null;

                      return (
                        <div
                          key={img.id}
                          className={
                            "admin-image-card" + (img.toDelete ? " admin-image-card--deleted" : "")
                          }
                        >
                          <div className="admin-image-card__thumb-wrap">
                            <img
                              src={resolveMediaUrl(preview)}
                              alt=""
                              className="admin-image-card__thumb"
                            />

                            <div className="admin-image-card__index-badge">
                              <input
                                type="number"
                                min="1"
                                className="admin-image-card__index-input"
                                value={img.order ?? ""}
                                onChange={(e) =>
                                  handleCreateImageOrderChange(img.id, Number(e.target.value) || 1)
                                }
                              />
                            </div>

                            {!img.toDelete && (
                              <button
                                type="button"
                                className="admin-image-card__remove"
                                onClick={() => markCreateImageForDelete(img.id)}
                              >
                                ×
                              </button>
                            )}
                          </div>

                          {img.toDelete && (
                            <button
                              type="button"
                              className="admin-image-card__undo"
                              onClick={() => undoCreateImageDelete(img.id)}
                            >
                              Отменить удаление
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {/* Карточка добавления новых фото */}
                    <label
                      className="admin-image-add"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleCreateImageDrop}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="admin-image-add__input"
                        onChange={handleCreateImageInputChange}
                      />
                      <div className="admin-image-add__icon">+</div>
                      <div className="admin-image-add__text">
                        Перетащите фото или нажмите, чтобы выбрать
                      </div>
                    </label>
                  </div>
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

