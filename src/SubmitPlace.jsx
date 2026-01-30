import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "/api" : "http://localhost:3001");

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

export default function SubmitPlacePage() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [images, setImages] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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
      setUser(u);
    } catch (e) {
      console.error("Не удалось прочитать user из localStorage:", e);
      navigate("/login");
    }
  }, [navigate]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const parseFeatures = (text) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const handleImageFiles = (filesList) => {
    const files = Array.from(filesList || []);
    if (!files.length) return;

    setImages((prev) => {
      const maxOrder = prev.reduce(
        (max, img) => Math.max(max, Number(img.order || 0)),
        0
      );
      let currentOrder = maxOrder;

      const newItems = files.map((file, idx) => {
        currentOrder += 1;
        return {
          id: `submit-new-${Date.now()}-${idx}`,
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

  const handleImageOrderChange = (id, newOrder) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, order: newOrder } : img))
    );
  };

  const markImageForDelete = (id) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, toDelete: true } : img))
    );
  };

  const undoImageDelete = (id) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, toDelete: false } : img))
    );
  };

  const uploadNewImages = async (imagesList) => {
    const newImages = (imagesList || []).filter(
      (img) => img.isNew && img.file && !img.toDelete
    );
    if (!newImages.length) return [];

    const formData = new FormData();
    newImages.forEach((img) => formData.append("files", img.file));

    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });

    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      throw new Error(`Ошибка загрузки (${res.status}). Сервер вернул не JSON: ${text.slice(0, 120)}`);
    }

    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || `Не удалось загрузить изображения (${res.status})`);
    }
    return data.urls || [];
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const nameValue = form.name.trim();
      const cityValue = form.city.trim();
      const addressValue = form.address.trim();
      const imageValue = form.image.trim();
      const hasImages = images.some((img) => !img.toDelete);

      if (!nameValue || !cityValue || !addressValue) {
        setError("Название, город и адрес обязательны.");
        return;
      }

      if (!imageValue && !hasImages) {
        setError("Нужно добавить хотя бы одно фото.");
        return;
      }

      const uploadedUrls = await uploadNewImages(images);
      let uploadIndex = 0;

      const finalImages = images
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
        type: form.type.trim(),
        city: cityValue,
        address: addressValue,
        image: imagesForServer[0] || imageValue,
        images: imagesForServer,
        badge: form.badge.trim(),
        rating: form.rating ? Number(form.rating) : null,
        reviews: form.reviews ? Number(form.reviews) : null,
        features: parseFeatures(form.featuresText),
        link: form.link.trim(),
        hours: form.hours.trim() || null,
        phone: form.phone.trim() || null,
        submittedBy: user?.login || null,
        moderationStatus: "pending",
      };

      const res = await fetch(`${API_BASE}/api/places`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!data.ok) {
        setError(data.message || "Не удалось отправить место");
        return;
      }

      setSuccess("Место отправлено на модерацию. Спасибо!");
      setForm(emptyForm);
      setImages([]);
    } catch (e) {
      console.error("Ошибка отправки места:", e);
      setError(e.message || "Ошибка соединения с сервером");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="submit-section">
      <div className="container">
        <div className="submit-header">
          <h1 className="submit-title">Добавить новое место</h1>
          <p className="submit-subtitle">
            Заполните форму — место отправится на модерацию администратору, который проверит и опубликует.
          </p>
        </div>

        {error && <div className="admin__alert admin__alert--error">{error}</div>}
        {success && <div className="admin__alert admin__alert--success">{success}</div>}

        <form className="admin-form" onSubmit={handleSubmit}>
          <div className="admin-form__grid">
            <input
              type="text"
              name="name"
              className="admin-input"
              placeholder="Название"
              value={form.name}
              onChange={handleChange}
              required
            />
            <input
              type="text"
              name="type"
              className="admin-input"
              placeholder="Тип (кафе, коворкинг...)"
              value={form.type}
              onChange={handleChange}
            />
            <input
              type="text"
              name="city"
              className="admin-input"
              placeholder="Город"
              value={form.city}
              onChange={handleChange}
              required
            />
            <input
              type="text"
              name="address"
              className="admin-input"
              placeholder="Адрес"
              value={form.address}
              onChange={handleChange}
              required
            />
            <input
              type="text"
              name="image"
              className="admin-input"
              placeholder="Главная картинка (путь, например: /p1p1.png)"
              value={form.image}
              onChange={handleChange}
            />
            <input
              type="text"
              name="badge"
              className="admin-input"
              placeholder="Бейдж (например: Бесплатно, PP)"
              value={form.badge}
              onChange={handleChange}
            />
            <input
              type="number"
              step="0.1"
              name="rating"
              className="admin-input"
              placeholder="Рейтинг (например: 4.5)"
              value={form.rating}
              onChange={handleChange}
            />
            <input
              type="number"
              name="reviews"
              className="admin-input"
              placeholder="Кол-во отзывов"
              value={form.reviews}
              onChange={handleChange}
            />
            <input
              type="text"
              name="link"
              className="admin-input"
              placeholder="Ссылка на Яндекс.Карты"
              value={form.link}
              onChange={handleChange}
            />
            <input
              type="text"
              name="phone"
              className="admin-input"
              placeholder="Телефон (например: +7 999 123-45-67)"
              value={form.phone}
              onChange={handleChange}
            />
            <input
              type="text"
              name="hours"
              className="admin-input"
              placeholder="График работы (например: Пн–Пт 09:00–21:00)"
              value={form.hours}
              onChange={handleChange}
            />
          </div>

          <div className="admin-images">
            <div className="admin-images__header">
              <span>Фотографии</span>
              <span className="admin-images__hint">
                Перетаскивай, кликай, меняй порядок
              </span>
            </div>

            <div className="admin-images__grid">
              {images.map((img) => {
                const preview = img.previewUrl || img.url;
                if (!preview) return null;

                return (
                  <div
                    key={img.id}
                    className={
                      "admin-image-card" +
                      (img.toDelete ? " admin-image-card--deleted" : "")
                    }
                  >
                    <div className="admin-image-card__thumb-wrap">
                      <img src={preview} alt="" className="admin-image-card__thumb" />

                      <div className="admin-image-card__index-badge">
                        <input
                          type="number"
                          min="1"
                          className="admin-image-card__index-input"
                          value={img.order ?? ""}
                          onChange={(e) =>
                            handleImageOrderChange(img.id, Number(e.target.value) || 1)
                          }
                        />
                      </div>

                      {!img.toDelete && (
                        <button
                          type="button"
                          className="admin-image-card__remove"
                          onClick={() => markImageForDelete(img.id)}
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
                      <div className="admin-image-card__path" title={img.url}>
                        {img.url}
                      </div>
                    )}
                  </div>
                );
              })}

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
              value={form.featuresText}
              onChange={handleChange}
            />
          </label>

          <button type="submit" className="admin-submit" disabled={loading}>
            {loading ? "Отправляем..." : "Отправить на модерацию"}
          </button>
        </form>
      </div>
    </section>
  );
}

