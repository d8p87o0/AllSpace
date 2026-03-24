// src/Admin.jsx
import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";
import SEO, { SEO_SITE_URL } from "./SEO.jsx";
import { API_BASE, readJsonResponse } from "./api.js";

<SEO
  title="Админ-панель — ALLSPACE"
  description="Служебная страница."
  url={`${SEO_SITE_URL}/admin`}
  noindex={true}
/>

function resolveMediaUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/photos/") || url.startsWith("/avatars/")) return `${API_BASE}${url}`;
  return url;
}

async function uploadFiles(files) {
  const fd = new FormData();
  Array.from(files || []).forEach((f) => fd.append("files", f));
  const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
  const data = await readJsonResponse(res, "Загрузка изображений");
  if (!data.ok) throw new Error(data.message || "Не удалось загрузить файл");
  return data.urls || [];
}

// --- helpers for article images (extract/remove/replace) ---
function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function extractImageUrlsFromBlocks(blocks) {
  const out = [];
  const push = (u) => {
    if (!u) return;
    const s = String(u).trim();
    if (!s) return;
    if (!out.includes(s)) out.push(s);
  };

  const walkHtml = (html) => {
    if (!html) return;
    const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      push(m[1]);
    }
  };

  (blocks || []).forEach((b) => {
    if (!b) return;
    if (b.type === "image" && b.url) push(b.url);
    if (typeof b.html === "string") walkHtml(b.html);
  });

  return out;
}

function removeImageUrlFromBlocks(blocks, urlToRemove) {
  const u = String(urlToRemove || "").trim();
  if (!u) return blocks;

  const cleanHtml = (html) => {
    if (!html) return html;
    // remove <img ... src="u" ...> (and self-closing variants)
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reImg = new RegExp(`<img[^>]+src=["']${esc}["'][^>]*>`, "gi");
    let next = html.replace(reImg, "");
    // remove empty figures that may remain: <figure> ... </figure> with nothing meaningful
    next = next.replace(/<figure[^>]*>\s*<\/figure>/gi, "");
    return next;
  };

  const next = (blocks || [])
    .map((b) => {
      if (!b) return b;
      if (b.type === "image" && String(b.url || "").trim() === u) {
        return null; // drop the whole block
      }
      if (typeof b.html === "string") {
        return { ...b, html: cleanHtml(b.html) };
      }
      return b;
    })
    .filter(Boolean);

  return next;
}

// ====== places stuff (как было) ======
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
    window.location.href = "/";
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem("user");
    } catch (e) {
      console.error("Ошибка очистки user из localStorage:", e);
    }
    navigate("/login");
  }

  const loadStats = async () => {
    setStatsLoading(true);
    setStatsError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/stats/overview`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Не удалось загрузить статистику");
      setStats(data.stats || null);
    } catch (e) {
      console.error("Ошибка загрузки статистики:", e);
      setStatsError("Не удалось загрузить статистику");
    } finally {
      setStatsLoading(false);
    }
  };

  const [user, setUser] = useState(null);

  // ===== tabs =====
  const [activeTab, setActiveTab] = useState("places"); // "places" | "articles" | "stats"

  // ===== places state =====
  const [places, setPlaces] = useState([]);
  const [pendingPlaces, setPendingPlaces] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [placeReviews, setPlaceReviews] = useState([]);
  const [placeReviewsLoading, setPlaceReviewsLoading] = useState(false);
  const [placeReviewsError, setPlaceReviewsError] = useState("");
  const [reviewSavingId, setReviewSavingId] = useState(null);
  const [reviewDeletingId, setReviewDeletingId] = useState(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // images for places
  const [editImages, setEditImages] = useState([]);
  const [createImages, setCreateImages] = useState([]);
  const placesListRef = useRef(null);
  const selectionRestoredRef = useRef(false);

  const buildImagesForEdit = (place, photos = []) => {
    const base =
      Array.isArray(photos) && photos.length
        ? photos
        : place.images && Array.isArray(place.images) && place.images.length
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

  // ===== articles state =====
  const [articles, setArticles] = useState([]);
  const [pendingArticles, setPendingArticles] = useState([]);
  const [articlesLoading, setArticlesLoading] = useState(false);

  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [articleEdit, setArticleEdit] = useState({
    title: "",
    coverImage: "",
    displayOrder: 0,
    status: "draft",
    contentJson: "[]",
    excerpt: "",
  });

  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [stats, setStats] = useState(null);

  // article images UI state
  const [articleImages, setArticleImages] = useState([]); // [{ id, url, toDelete, isNew, file, previewUrl, isCover }]
  const articleImageInputRef = useRef(null);
  const coverFileInputRef = useRef(null);

  // ===== auth =====
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

  useEffect(() => {
    if (activeTab === "stats") {
      loadStats();
    }
  }, [activeTab]);

  // ===== load places =====
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
      if (data.ok) setPendingPlaces(data.places || []);
      else setPendingPlaces([]);
    } catch (e) {
      console.error("Ошибка загрузки мест на модерации:", e);
      setPendingPlaces([]);
    } finally {
      setPendingLoading(false);
    }
  };

  // ===== load articles =====
  const loadArticles = async () => {
    setArticlesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/articles?status=approved`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Не удалось загрузить статьи");
      setArticles(data.articles || []);
    } catch (e) {
      console.error(e);
      setArticles([]);
    } finally {
      setArticlesLoading(false);
    }
  };

  const loadPendingArticles = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/articles?status=pending`);
      const data = await res.json();
      if (data.ok) setPendingArticles(data.articles || []);
      else setPendingArticles([]);
    } catch (e) {
      console.error(e);
      setPendingArticles([]);
    }
  };

  useEffect(() => {
    loadPlaces();
    loadPendingPlaces();
    loadArticles();
    loadPendingArticles();
  }, []);

  // ===== places selection restore =====
  useEffect(() => {
    if (selectionRestoredRef.current) return;
    if (loading) return;
    if (!places.length) return;

    let storedId = null;
    try {
      storedId = localStorage.getItem("admin_selected_place_id");
    } catch {}

    if (!storedId) return;
    const idNum = Number(storedId);
    if (!Number.isFinite(idNum)) return;

    const place = places.find((p) => p.id === idNum);
    if (!place) return;

    selectionRestoredRef.current = true;
    handleSelectPlace(place);
  }, [loading, places]);

  useEffect(() => {
    if (!placesListRef.current || !selectedPlaceId) return;
    const container = placesListRef.current;
    const activeBtn = container.querySelector(".admin__place-btn--active");
    if (!activeBtn) return;
    try {
      activeBtn.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      activeBtn.scrollIntoView();
    }
  }, [places, selectedPlaceId]);

  // ===== place reviews load =====
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

  const handleSelectPlace = async (place) => {
    setSelectedPlaceId(place.id);

    try {
      localStorage.setItem("admin_selected_place_id", String(place.id));
    } catch {}

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

    setEditImages([]);
    setSuccess("");
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/places/${place.id}/photos`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.photos) && data.photos.length) {
        setEditImages(buildImagesForEdit(place, data.photos));
      } else {
        setEditImages(buildImagesForEdit(place, []));
      }
    } catch (e) {
      console.error("Ошибка загрузки фото для редактирования:", e);
      setEditImages(buildImagesForEdit(place, []));
    }
  };

  const approvePlace = async (placeId) => {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API_BASE}/api/places/${placeId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || "Не удалось одобрить место");
        return;
      }
      setSuccess("Место одобрено");
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
      const res = await fetch(`${API_BASE}/api/places/${placeId}/reject`, { method: "POST" });
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

  // ===== images helpers (places) =====
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

  const handleImageOrderChange = (id, newOrder) => {
    setEditImages((prev) => prev.map((img) => (img.id === id ? { ...img, order: newOrder } : img)));
  };

  const markImageForDelete = (id) => {
    setEditImages((prev) => prev.map((img) => (img.id === id ? { ...img, toDelete: true } : img)));
  };

  const undoImageDelete = (id) => {
    setEditImages((prev) => prev.map((img) => (img.id === id ? { ...img, toDelete: false } : img)));
  };

  const handleImageFiles = (filesList) => {
    const files = Array.from(filesList || []);
    if (!files.length) return;

    setEditImages((prev) => {
      const maxOrder = prev.reduce((max, img) => Math.max(max, Number(img.order || 0)), 0);
      let currentOrder = maxOrder;

      const newItems = files.map((file, idx) => {
        currentOrder += 1;
        return {
          id: `new-${Date.now()}-${idx}`,
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

  const handleImageInputChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      handleImageFiles(event.target.files);
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

  const handleCreateImageOrderChange = (id, newOrder) => {
    setCreateImages((prev) => prev.map((img) => (img.id === id ? { ...img, order: newOrder } : img)));
  };

  const markCreateImageForDelete = (id) => {
    setCreateImages((prev) => prev.map((img) => (img.id === id ? { ...img, toDelete: true } : img)));
  };

  const undoCreateImageDelete = (id) => {
    setCreateImages((prev) => prev.map((img) => (img.id === id ? { ...img, toDelete: false } : img)));
  };

  const handleCreateImageFiles = (filesList) => {
    const files = Array.from(filesList || []);
    if (!files.length) return;

    setCreateImages((prev) => {
      const maxOrder = prev.reduce((max, img) => Math.max(max, Number(img.order || 0)), 0);
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

  const uploadNewImages = async (images) => {
    const newImages = (images || []).filter((img) => img.isNew && img.file && !img.toDelete);
    if (!newImages.length) return [];

    const formData = new FormData();
    newImages.forEach((img) => formData.append("files", img.file));

    const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: formData });
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
      const uploadedUrls = await uploadNewImages(editImages);
      let uploadIndex = 0;

      const finalImages = editImages
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

      const body = {
        name: editForm.name.trim(),
        type: editForm.type.trim(),
        city: editForm.city.trim(),
        address: editForm.address.trim(),
        image: imagesForServer[0] || editForm.image.trim(),
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
      if (data.place) handleSelectPlace(data.place);
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

      const uploadedUrls = await uploadNewImages(createImages);
      let uploadIndex = 0;

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

      const body = {
        name: nameValue,
        type: createForm.type.trim(),
        city: cityValue,
        address: addressValue,
        image: imagesForServer[0] || imageValue,
        images: imagesForServer,
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

      const data = await readJsonResponse(res, "Добавление места");
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

  // ===== reviews actions =====
  const handleReviewDraftChange = (reviewId, field, value) => {
    setPlaceReviews((prev) => prev.map((review) => (review.id === reviewId ? { ...review, [field]: value } : review)));
  };

  const handleReviewReset = (reviewId) => {
    setPlaceReviews((prev) => prev.map((review) => (review.id === reviewId ? normalizeReviewDraft(review) : review)));
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
      const res = await fetch(`${API_BASE}/api/places/${selectedPlaceId}/reviews/${review.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textValue,
          rating: ratingValue,
          userId: user?.id ?? null,
          userLogin: user?.login ?? null,
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        setPlaceReviewsError(data.message || "Не удалось сохранить отзыв");
        return;
      }

      if (data.review) {
        setPlaceReviews((prev) => prev.map((item) => (item.id === review.id ? normalizeReviewDraft(data.review) : item)));
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
      const res = await fetch(`${API_BASE}/api/places/${selectedPlaceId}/reviews/${reviewId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user?.id ?? null,
          userLogin: user?.login ?? null,
        }),
      });

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
      const res = await fetch(`${API_BASE}/api/places/${deleteTarget.id}`, { method: "DELETE" });
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
        try {
          localStorage.removeItem("admin_selected_place_id");
        } catch {}
      }

      await loadPlaces();
    } catch (e) {
      console.error("Ошибка удаления места:", e);
      setError("Ошибка соединения с сервером");
    }
  };

  // ===== articles actions =====
  const approveArticle = async (id) => {
    setError("");
    setSuccess("");
    const res = await fetch(`${API_BASE}/api/articles/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user?.id ?? null, userLogin: user?.login ?? null }),
    });
    const data = await res.json();
    if (!data.ok) return setError(data.message || "Не удалось одобрить статью");
    setSuccess("Статья одобрена");
    await loadPendingArticles();
    await loadArticles();
  };

  const rejectArticle = async (id) => {
    const ok = window.confirm("Отклонить эту статью?");
    if (!ok) return;

    setError("");
    setSuccess("");
    const res = await fetch(`${API_BASE}/api/articles/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user?.id ?? null, userLogin: user?.login ?? null }),
    });
    const data = await res.json();
    if (!data.ok) return setError(data.message || "Не удалось отклонить статью");
    setSuccess("Статья отклонена");
    await loadPendingArticles();
  };

  const deleteArticle = async (a) => {
    const ok = window.confirm(`Удалить статью "${a.title}"?`);
    if (!ok) return;

    setError("");
    setSuccess("");
    const r = await fetch(`${API_BASE}/api/articles/${a.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user?.id ?? null, userLogin: user?.login ?? null }),
    });
    const d = await r.json();
    if (!d.ok) return setError(d.message || "Не удалось удалить");

    setSuccess("Статья удалена");
    if (selectedArticleId === a.id) {
      setSelectedArticleId(null);
      setArticleEdit({
        title: "",
        coverImage: "",
        displayOrder: 0,
        status: "draft",
        contentJson: "[]",
        excerpt: "",
      });
      setArticleImages([]);
    }

    await loadArticles();
    await loadPendingArticles();
  };

  const handleSelectArticle = (a) => {
    setSelectedArticleId(a.id);

    const contentJson = JSON.stringify(a.content || [], null, 2);

    setArticleEdit({
      title: a.title || "",
      coverImage: a.coverImage || "",
      displayOrder: Number(a.displayOrder || 0),
      status: a.status || "pending",
      contentJson,
      excerpt: a.excerpt || "",
    });

    const blocks = a.content || [];
    const imgs = extractImageUrlsFromBlocks(blocks);
    const cover = String(a.coverImage || "").trim();

    const list = imgs.map((url, idx) => ({
      id: `img-${a.id}-${idx}`,
      url,
      toDelete: false,
      isNew: false,
      file: null,
      previewUrl: null,
      isCover: cover && String(url).trim() === cover,
    }));

    // если cover есть, но в тексте нет — всё равно показываем отдельной карточкой
    const hasCoverInText = cover && imgs.includes(cover);
    const extraCoverCard =
      cover && !hasCoverInText
        ? [
            {
              id: `cover-only-${a.id}`,
              url: cover,
              toDelete: false,
              isNew: false,
              file: null,
              previewUrl: null,
              isCover: true,
              coverOnly: true,
            },
          ]
        : [];

    setArticleImages([...extraCoverCard, ...list]);
  };

  const markArticleImageForDelete = (id) => {
    setArticleImages((prev) => prev.map((img) => (img.id === id ? { ...img, toDelete: true } : img)));
  };

  const undoArticleImageDelete = (id) => {
    setArticleImages((prev) => prev.map((img) => (img.id === id ? { ...img, toDelete: false } : img)));
  };

  const setAsCover = (url) => {
    setArticleEdit((s) => ({ ...s, coverImage: url }));
    setArticleImages((prev) =>
      prev.map((img) => ({ ...img, isCover: String(img.url).trim() === String(url).trim() }))
    );
  };

  const changeCoverForArticle = async (files) => {
    const f = files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      setError("Нужно выбрать картинку (png/jpg/webp).");
      return;
    }
  
    try {
      setArticlesLoading(true);
      const [url] = await uploadFiles([f]);
      if (!url) throw new Error("Не удалось загрузить обложку");
  
      // обновляем поле обложки
      setArticleEdit((s) => ({ ...s, coverImage: url }));
  
      // чтобы бейдж “ОБЛОЖКА” в списке картинок стал корректным
      setArticleImages((prev) => {
        // если этой картинки ещё нет в списке — добавим карточку
        const exists = prev.some((img) => String(img.url).trim() === String(url).trim());
        const next = exists
          ? prev
          : [
              {
                id: `cover-upload-${Date.now()}`,
                url,
                toDelete: false,
                isNew: true,
                file: null,
                previewUrl: null,
                isCover: true,
                coverOnly: true,
              },
              ...prev,
            ];
  
        return next.map((img) => ({ ...img, isCover: String(img.url).trim() === String(url).trim() }));
      });
    } catch (e) {
      setError(e.message || "Не удалось загрузить обложку");
    } finally {
      setArticlesLoading(false);
    }
  };

  const submitArticleEdit = async (e) => {
    e.preventDefault();
    if (!selectedArticleId) return;

    let blocks = safeJsonParse(articleEdit.contentJson || "[]", []);
    if (!Array.isArray(blocks)) blocks = [];

    // применяем удаления картинок к blocks
    const toRemove = articleImages.filter((img) => img.toDelete).map((img) => img.url);
    toRemove.forEach((u) => {
      blocks = removeImageUrlFromBlocks(blocks, u);
    });

    // если удалили обложку (или она пустая/удалена) — подправим cover
    const cover = String(articleEdit.coverImage || "").trim();
    const coverDeleted = cover && toRemove.includes(cover);
    let nextCover = coverDeleted ? "" : cover;

    // если cover пустой, но есть картинки — можно оставить пустым (ты сам руками поставишь)
    // но чтобы было понятно — мы НЕ автоставим

    const payload = {
      title: articleEdit.title,
      coverImage: nextCover,
      content: blocks,
      excerpt: articleEdit.excerpt,
      status: articleEdit.status,
      displayOrder: Number(articleEdit.displayOrder || 0),
      userId: user?.id ?? null,
      userLogin: user?.login ?? null,
    };

    const res = await fetch(`${API_BASE}/api/articles/${selectedArticleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!data.ok) return setError(data.message || "Не удалось сохранить статью");

    setSuccess("Статья сохранена");

    // перезагрузим списки и текущую статью (чтобы список картинок пересобрался)
    await loadPendingArticles();
    await loadArticles();

    // обновим локально картинки/контент, чтобы UI сразу был верный
    setArticleEdit((s) => ({ ...s, coverImage: nextCover, contentJson: JSON.stringify(blocks, null, 2) }));

    const imgsNow = extractImageUrlsFromBlocks(blocks);
    setArticleImages((prev) =>
      prev
        .filter((img) => !img.toDelete) // убираем удалённые
        .map((img) => ({
          ...img,
          isCover: String(img.url).trim() === String(nextCover).trim() && !!nextCover,
        }))
        .filter((img) => imgsNow.includes(String(img.url).trim()) || img.isCover) // чистим мусор
    );
  };

  if (!user) return null;

  return (
    <section className="admin">
      <div className="container admin__inner">
        <div className="admin__header">
          <div>
            <h1 className="admin__title">Админ-панель</h1>

            <div className="admin__tabs">
              <button
                type="button"
                className={"admin__tab" + (activeTab === "places" ? " admin__tab--active" : "")}
                onClick={() => setActiveTab("places")}
              >
                Места
              </button>
              <button
                type="button"
                className={"admin__tab" + (activeTab === "articles" ? " admin__tab--active" : "")}
                onClick={() => setActiveTab("articles")}
              >
                Статьи
              </button>
              <button
                type="button"
                className={"admin__tab" + (activeTab === "stats" ? " admin__tab--active" : "")}
                onClick={() => setActiveTab("stats")}
              >
                Статистика
              </button>
            </div>

            <p className="admin__subtitle">
              {activeTab === "places"
                ? "Управление местами для каталога"
                : activeTab === "articles"
                ? "Управление статьями"
                : "Метрики сайта и поведения пользователей"}
            </p>

            {selectedArticleId && (
              <button
                type="button"
                className="admin__delete-btn"
                onClick={() => {
                  const a = articles.find((x) => x.id === selectedArticleId);
                  if (a) deleteArticle(a);
                }}
              >
                Удалить выбранную статью
              </button>
            )}
          </div>

          <div className="admin__header-actions">
            <button type="button" className="admin__back-btn" onClick={goToSite}>
              На сайт
            </button>
            <button type="button" className="admin__logout-btn" onClick={handleLogout}>
              Выйти
            </button>
          </div>
        </div>

        {error && <div className="admin__alert admin__alert--error">{error}</div>}
        {success && <div className="admin__alert admin__alert--success">{success}</div>}

        {/* ===================== TAB: PLACES ===================== */}
        {activeTab === "places" && (
          <div className="admin__layout">
            <aside className="admin__sidebar">
              <h2 className="admin__sidebar-title">Места</h2>

              {loading ? (
                <p className="admin__sidebar-empty">Загружаем...</p>
              ) : places.length === 0 ? (
                <p className="admin__sidebar-empty">В базе пока нет мест. Добавьте первое.</p>
              ) : (
                <div className="admin__places-list" ref={placesListRef}>
                  {places.map((place) => (
                    <button
                      key={place.id}
                      type="button"
                      className={
                        "admin__place-btn" + (place.id === selectedPlaceId ? " admin__place-btn--active" : "")
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
                <button type="button" className="admin__delete-btn" onClick={() => setDeleteTarget(selectedPlace)}>
                  Удалить выбранное место
                </button>
              )}
            </aside>

            <div className="admin__content">
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
                            <span className="admin__moderation-meta">Отправил: {place.submitted_by}</span>
                          )}
                        </div>
                        <div className="admin__moderation-actions">
                          <button type="button" className="admin__moderation-open" onClick={() => handleSelectPlace(place)}>
                            Открыть
                          </button>
                          <button type="button" className="admin__moderation-approve" onClick={() => approvePlace(place.id)}>
                            Одобрить
                          </button>
                          <button type="button" className="admin__moderation-reject" onClick={() => rejectPlace(place.id)}>
                            Отклонить
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="admin__card">
                <h2 className="admin__card-title">Редактирование места</h2>
                {selectedPlaceId && selectedPlaceStatus === "pending" && (
                  <div className="admin__moderation-status">Статус: на модерации</div>
                )}

                {!selectedPlaceId ? (
                  <p className="admin__hint">Выберите место слева, чтобы отредактировать.</p>
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

                    {/* images for place */}
                    <div className="admin-images">
                      <div className="admin-images__header">
                        <span>Фотографии</span>
                        <span className="admin-images__hint">Перетаскивай, кликай, меняй порядок</span>
                      </div>

                      <div className="admin-images__grid">
                        {editImages.map((img) => {
                          const preview = img.previewUrl || img.url;
                          if (!preview) return null;
                          return (
                            <div
                              key={img.id}
                              className={"admin-image-card" + (img.toDelete ? " admin-image-card--deleted" : "")}
                            >
                              <div className="admin-image-card__thumb-wrap">
                                <img src={resolveMediaUrl(preview)} alt="" className="admin-image-card__thumb" />

                                <div className="admin-image-card__index-badge">
                                  <input
                                    type="number"
                                    min="1"
                                    className="admin-image-card__index-input"
                                    value={img.order ?? ""}
                                    onChange={(e) => handleImageOrderChange(img.id, Number(e.target.value) || 1)}
                                  />
                                </div>

                                {!img.toDelete && (
                                  <button type="button" className="admin-image-card__remove" onClick={() => markImageForDelete(img.id)}>
                                    ×
                                  </button>
                                )}
                              </div>

                              {img.toDelete && (
                                <button type="button" className="admin-image-card__undo" onClick={() => undoImageDelete(img.id)}>
                                  Отменить удаление
                                </button>
                              )}

                              {!img.isNew && (
                                <div className="admin-image-card__path" title={img.url}>
                                  {img.url}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        <label className="admin-image-add" onDragOver={(e) => e.preventDefault()} onDrop={handleImageDrop}>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="admin-image-add__input"
                            onChange={handleImageInputChange}
                          />
                          <div className="admin-image-add__icon">+</div>
                          <div className="admin-image-add__text">Перетащите фото или нажмите, чтобы выбрать</div>
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

              <div className="admin__card">
                <h2 className="admin__card-title">Отзывы места</h2>

                {!selectedPlaceId ? (
                  <p className="admin__hint">Выберите место, чтобы управлять отзывами.</p>
                ) : (
                  <div className="admin-reviews">
                    <div className="admin-reviews__header">
                      <div className="admin-reviews__count">Всего: {placeReviews.length}</div>
                      <button
                        type="button"
                        className="admin-reviews__refresh"
                        onClick={() => loadPlaceReviews(selectedPlaceId)}
                        disabled={placeReviewsLoading}
                      >
                        Обновить
                      </button>
                    </div>

                    {placeReviewsError && <div className="admin__alert admin__alert--error">{placeReviewsError}</div>}

                    {placeReviewsLoading ? (
                      <p className="admin__hint">Загружаем отзывы...</p>
                    ) : placeReviews.length ? (
                      <div className="admin-reviews__list">
                        {placeReviews.map((review) => {
                          const displayName = review.userName || review.userLogin || "Гость";
                          const reviewDate = formatReviewDate(review.createdAt);
                          const metaParts = [];
                          if (review.userLogin) metaParts.push(`@${review.userLogin}`);
                          if (reviewDate) metaParts.push(reviewDate);

                          return (
                            <div key={review.id} className="admin-review">
                              <div className="admin-review__header">
                                <div>
                                  <div className="admin-review__name">{displayName}</div>
                                  {metaParts.length > 0 && <div className="admin-review__meta">{metaParts.join(" · ")}</div>}
                                </div>
                                <div className="admin-review__rating">
                                  <input
                                    type="number"
                                    min="1"
                                    max="5"
                                    className="admin-input admin-review__rating-input"
                                    value={review.draftRating}
                                    onChange={(e) => handleReviewDraftChange(review.id, "draftRating", e.target.value)}
                                  />
                                </div>
                              </div>

                              <textarea
                                className="admin-textarea admin-review__text"
                                value={review.draftText}
                                onChange={(e) => handleReviewDraftChange(review.id, "draftText", e.target.value)}
                                rows={3}
                              />

                              {Array.isArray(review.images) && review.images.length > 0 && (
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
                                  {reviewSavingId === review.id ? "Сохраняем..." : "Сохранить"}
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
                                  {reviewDeletingId === review.id ? "Удаляем..." : "Удалить"}
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

                  <div className="admin-images">
                    <div className="admin-images__header">
                      <span>Фотографии</span>
                      <span className="admin-images__hint">Перетаскивай, кликай, меняй порядок</span>
                    </div>

                    <div className="admin-images__grid">
                      {createImages.map((img) => {
                        const preview = img.previewUrl || img.url;
                        if (!preview) return null;

                        return (
                          <div key={img.id} className={"admin-image-card" + (img.toDelete ? " admin-image-card--deleted" : "")}>
                            <div className="admin-image-card__thumb-wrap">
                              <img src={resolveMediaUrl(preview)} alt="" className="admin-image-card__thumb" />

                              <div className="admin-image-card__index-badge">
                                <input
                                  type="number"
                                  min="1"
                                  className="admin-image-card__index-input"
                                  value={img.order ?? ""}
                                  onChange={(e) => handleCreateImageOrderChange(img.id, Number(e.target.value) || 1)}
                                />
                              </div>

                              {!img.toDelete && (
                                <button type="button" className="admin-image-card__remove" onClick={() => markCreateImageForDelete(img.id)}>
                                  ×
                                </button>
                              )}
                            </div>

                            {img.toDelete && (
                              <button type="button" className="admin-image-card__undo" onClick={() => undoCreateImageDelete(img.id)}>
                                Отменить удаление
                              </button>
                            )}
                          </div>
                        );
                      })}

                      <label className="admin-image-add" onDragOver={(e) => e.preventDefault()} onDrop={handleCreateImageDrop}>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="admin-image-add__input"
                          onChange={handleCreateImageInputChange}
                        />
                        <div className="admin-image-add__icon">+</div>
                        <div className="admin-image-add__text">Перетащите фото или нажмите, чтобы выбрать</div>
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
        )}

        {/* ===================== TAB: ARTICLES ===================== */}
        {activeTab === "articles" && (
          <div className="admin__layout">
            <aside className="admin__sidebar">
              <h2 className="admin__sidebar-title">Статьи</h2>

              {articlesLoading ? (
                <p className="admin__sidebar-empty">Загружаем...</p>
              ) : articles.length === 0 ? (
                <p className="admin__sidebar-empty">Одобренных статей нет.</p>
              ) : (
                <div className="admin__places-list">
                  <div style={{ padding: "0 10px 8px", fontSize: 12, color: "#777" }}>
                    <div>
                      <b>Заголовок</b> / <b>Автор</b>
                    </div>
                  </div>

                  {articles.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={"admin__place-btn" + (a.id === selectedArticleId ? " admin__place-btn--active" : "")}
                      onClick={() => handleSelectArticle(a)}
                    >
                      <span className="admin__place-btn-name">{a.title}</span>
                      <span className="admin__place-btn-city">{a.authorLogin ? `@${a.authorLogin}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </aside>

            <div className="admin__content">
              <div className="admin__card">
                <h2 className="admin__card-title">Модерация статей</h2>

                {pendingArticles.length === 0 ? (
                  <p className="admin__hint">Нет статей на модерации</p>
                ) : (
                  <div className="admin__moderation-list">
                    {pendingArticles.map((a) => (
                      <div key={a.id} className="admin__moderation-item">
                        <div className="admin__moderation-info">
                          <span className="admin__moderation-name">{a.title}</span>
                          <span className="admin__moderation-meta">{a.authorLogin ? `@${a.authorLogin}` : ""}</span>
                        </div>
                        <div className="admin__moderation-actions">
                          <button type="button" className="admin__moderation-open" onClick={() => handleSelectArticle(a)}>
                            Открыть
                          </button>
                          <button type="button" className="admin__moderation-approve" onClick={() => approveArticle(a.id)}>
                            Одобрить
                          </button>
                          <button type="button" className="admin__moderation-reject" onClick={() => rejectArticle(a.id)}>
                            Отклонить
                          </button>
                          <button type="button" className="admin__moderation-reject" onClick={() => deleteArticle(a)}>
                            Удалить
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="admin__card">
                <h2 className="admin__card-title">Редактирование статьи</h2>

                {!selectedArticleId ? (
                  <p className="admin__hint">Выберите статью слева.</p>
                ) : (
                  <>
                    {/* КАРТИНКИ СТАТЬИ */}
                    {/* ===== Обложка статьи ===== */}
                    <div className="admin-article-media">
                      <div className="admin-article-media__head">
                        <div className="admin-article-media__title">Обложка статьи</div>
                        <div className="admin-article-media__hint">Обложка — это превью в каталоге</div>
                      </div>

                      <div className="admin-article-cover">
                        {/* Preview */}
                        <div className="admin-article-cover__preview">
                          {articleEdit.coverImage ? (
                            <>
                              <img
                                src={resolveMediaUrl(articleEdit.coverImage)}
                                alt=""
                                className="admin-article-cover__img"
                              />
                              <div className="admin-article-cover__badge">ОБЛОЖКА</div>
                            </>
                          ) : (
                            <div className="admin-article-cover__empty">
                              Обложка не выбрана
                              <span>Загрузи картинку — она станет превью в каталоге</span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="admin-article-cover__actions">
                          <label className="admin-article-cover__pick">
                            <input
                              ref={coverFileInputRef}
                              type="file"
                              accept="image/*"
                              className="admin-article-cover__file"
                              onChange={(e) => {
                                const files = e.target.files;
                                e.target.value = "";
                                changeCoverForArticle(files);
                              }}
                            />
                            <span className="admin-article-cover__pickIcon">+</span>
                            <span className="admin-article-cover__pickText">
                              {articleEdit.coverImage ? "Сменить обложку" : "Добавить обложку"}
                            </span>
                          </label>

                          {articleEdit.coverImage && (
                            <button
                              type="button"
                              className="admin-article-cover__danger"
                              onClick={() => {
                                // пометить текущую обложку на удаление (и очистить поле)
                                const cover = String(articleEdit.coverImage || "").trim();
                                setArticleEdit((s) => ({ ...s, coverImage: "" }));
                                setArticleImages((prev) =>
                                  prev.map((img) =>
                                    String(img.url).trim() === cover ? { ...img, toDelete: true } : img
                                  )
                                );
                              }}
                            >
                              Удалить обложку
                            </button>
                          )}

                          <div className="admin-article-cover__note">
                            Подсказка: можно вставить URL вручную в поле «Обложка», но лучше грузить файлом.
                          </div>
                        </div>
                      </div>
                    </div>

{/* ===== Картинки из контента (не обложка) ===== */}
{articleImages.filter((x) => !x.isCover).length > 0 && (
  <div className="admin-article-media" style={{ marginTop: 14 }}>
    <div className="admin-article-media__head">
      <div className="admin-article-media__title">Картинки из контента</div>
      <div className="admin-article-media__hint">
        Эти изображения используются внутри текста статьи
      </div>
    </div>

    <div className="admin-article-gallery">
      {articleImages
        .filter((img) => !img.isCover)
        .map((img) => {
          const preview = img.previewUrl || img.url;
          if (!preview) return null;

          return (
            <div
              key={img.id}
              className={"admin-article-gallery__item" + (img.toDelete ? " admin-article-gallery__item--deleted" : "")}
            >
              <img
                src={resolveMediaUrl(preview)}
                alt=""
                className="admin-article-gallery__img"
              />

              <div className="admin-article-gallery__actions">
                {!img.toDelete ? (
                  <>
                    <button
                      type="button"
                      className="admin-article-gallery__btn"
                      onClick={() => setAsCover(img.url)}
                    >
                      Сделать обложкой
                    </button>
                    <button
                      type="button"
                      className="admin-article-gallery__btn admin-article-gallery__btn--danger"
                      onClick={() => markArticleImageForDelete(img.id)}
                    >
                      Удалить
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="admin-article-gallery__btn"
                    onClick={() => undoArticleImageDelete(img.id)}
                  >
                    Отменить
                  </button>
                )}
              </div>

              <div className="admin-article-gallery__path" title={img.url}>
                {img.url}
              </div>
            </div>
          );
        })}
    </div>
  </div>
)}

                    {/* ФОРМА */}
                    <form className="admin-form" onSubmit={submitArticleEdit}>
                      <div className="admin-form__grid">
                        <label className="admin-label">
                          Заголовок статьи
                          <input
                            className="admin-input"
                            value={articleEdit.title}
                            onChange={(e) => setArticleEdit((s) => ({ ...s, title: e.target.value }))}
                            placeholder="Например: Тестовая статья"
                          />
                        </label>

                        <label className="admin-label">
                          Обложка (url /photos/... или https://...)
                          <input
                            className="admin-input"
                            value={articleEdit.coverImage}
                            onChange={(e) => {
                              const v = e.target.value;
                              setArticleEdit((s) => ({ ...s, coverImage: v }));
                              setArticleImages((prev) =>
                                prev.map((img) => ({
                                  ...img,
                                  isCover: String(img.url).trim() === String(v).trim() && !!v,
                                }))
                              );
                            }}
                            placeholder="/photos/uploads/..."
                          />
                        </label>

                        <label className="admin-label">
                          Порядок отображения (displayOrder)
                          <input
                            className="admin-input"
                            type="number"
                            value={articleEdit.displayOrder}
                            onChange={(e) => setArticleEdit((s) => ({ ...s, displayOrder: e.target.value }))}
                            placeholder="0"
                          />
                        </label>

                        <label className="admin-label">
                          Статус
                          <select
                            className="admin-input"
                            value={articleEdit.status}
                            onChange={(e) => setArticleEdit((s) => ({ ...s, status: e.target.value }))}
                          >
                            <option value="pending">pending</option>
                            <option value="approved">approved</option>
                            <option value="rejected">rejected</option>
                            <option value="draft">draft</option>
                          </select>
                        </label>
                      </div>

                      <label className="admin-label">
                        Контент (JSON блоков)
                        <textarea
                          className="admin-textarea"
                          rows={10}
                          value={articleEdit.contentJson}
                          onChange={(e) => setArticleEdit((s) => ({ ...s, contentJson: e.target.value }))}
                        />
                      </label>

                      <label className="admin-label">
                        Excerpt (краткое описание)
                        <textarea
                          className="admin-textarea"
                          rows={3}
                          value={articleEdit.excerpt}
                          onChange={(e) => setArticleEdit((s) => ({ ...s, excerpt: e.target.value }))}
                          placeholder="Короткое описание для превью"
                        />
                      </label>

                      <button type="submit" className="admin-submit">
                        Сохранить статью
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "stats" && (
          <div className="admin__content">
            <div className="admin__card">
              <h2 className="admin__card-title">Обзор</h2>

              {statsLoading ? (
                <p className="admin__hint">Загружаем статистику...</p>
              ) : statsError ? (
                <div className="admin__alert admin__alert--error">{statsError}</div>
              ) : !stats ? (
                <p className="admin__hint">Данных пока нет</p>
              ) : (
                <>
                  <div className="admin-stats-grid">
                    <div className="admin-stat-card">
                      <div className="admin-stat-card__label">Посетители сегодня</div>
                      <div className="admin-stat-card__value">{stats.todayVisitors ?? 0}</div>
                      <div className="admin-stat-card__sub">Вчера: {stats.yesterdayVisitors ?? 0}</div>
                    </div>

                    <div className="admin-stat-card">
                      <div className="admin-stat-card__label">Уникальные сегодня</div>
                      <div className="admin-stat-card__value">{stats.todayUniqueVisitors ?? 0}</div>
                      <div className="admin-stat-card__sub">Вчера: {stats.yesterdayUniqueVisitors ?? 0}</div>
                    </div>

                    <div className="admin-stat-card">
                      <div className="admin-stat-card__label">Среднее время на сайте</div>
                      <div className="admin-stat-card__value">{stats.avgSessionDurationHuman ?? "—"}</div>
                      <div className="admin-stat-card__sub">По всем сессиям</div>
                    </div>

                    <div className="admin-stat-card">
                      <div className="admin-stat-card__label">Показов pop-up</div>
                      <div className="admin-stat-card__value">{stats.tgPopupShown ?? 0}</div>
                      <div className="admin-stat-card__sub">Кликов подписки: {stats.tgPopupSubscribeClicks ?? 0}</div>
                    </div>

                    <div className="admin-stat-card">
                      <div className="admin-stat-card__label">Конверсия pop-up</div>
                      <div className="admin-stat-card__value">{stats.tgPopupConversion ?? "0%"}</div>
                      <div className="admin-stat-card__sub">Подписка / показ</div>
                    </div>

                    <div className="admin-stat-card">
                      <div className="admin-stat-card__label">Средняя глубина просмотра</div>
                      <div className="admin-stat-card__value">{stats.avgPagesPerSession ?? 0}</div>
                      <div className="admin-stat-card__sub">Страниц за сессию</div>
                    </div>
                  </div>

                  <div className="admin-stats-lists">
                    <div className="admin__card">
                      <h3 className="admin__card-title">Топ мест</h3>
                      {Array.isArray(stats.topPlaces) && stats.topPlaces.length ? (
                        <div className="admin-stats-ranking">
                          {stats.topPlaces.map((item, idx) => (
                            <div key={idx} className="admin-stats-ranking__row">
                              <span>{item.name}</span>
                              <b>{item.clicks}</b>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="admin__hint">Нет данных</p>
                      )}
                    </div>

                    <div className="admin__card">
                      <h3 className="admin__card-title">Топ статей</h3>
                      {Array.isArray(stats.topArticles) && stats.topArticles.length ? (
                        <div className="admin-stats-ranking">
                          {stats.topArticles.map((item, idx) => (
                            <div key={idx} className="admin-stats-ranking__row">
                              <span>{item.title}</span>
                              <b>{item.clicks}</b>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="admin__hint">Нет данных</p>
                      )}
                    </div>
                  </div>

                  <div className="admin-stats-lists">
                    <div className="admin__card">
                      <h3 className="admin__card-title">Источники трафика</h3>
                      {Array.isArray(stats.topSources) && stats.topSources.length ? (
                        <div className="admin-stats-ranking">
                          {stats.topSources.map((item, idx) => (
                            <div key={idx} className="admin-stats-ranking__row">
                              <span>{item.source}</span>
                              <b>{item.visits}</b>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="admin__hint">Нет данных</p>
                      )}
                    </div>

                    <div className="admin__card">
                      <h3 className="admin__card-title">Устройства</h3>
                      {Array.isArray(stats.devices) && stats.devices.length ? (
                        <div className="admin-stats-ranking">
                          {stats.devices.map((item, idx) => (
                            <div key={idx} className="admin-stats-ranking__row">
                              <span>{item.device}</span>
                              <b>{item.count}</b>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="admin__hint">Нет данных</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pop-up delete PLACE */}
      {deleteTarget && (
        <div className="admin-modal" onClick={() => setDeleteTarget(null)}>
          <div className="admin-modal__content" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal__title">Удалить место «{deleteTarget.name}»?</h3>
            <p className="admin-modal__text">Это действие нельзя будет отменить.</p>

            <div className="admin-modal__actions">
              <button type="button" className="admin-modal__btn admin-modal__btn--danger" onClick={confirmDelete}>
                Удалить
              </button>
              <button type="button" className="admin-modal__btn" onClick={() => setDeleteTarget(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
