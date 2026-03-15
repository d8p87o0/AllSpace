// src/SubmitArticle.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { normalizeBlocks, buildExcerpt } from "./telegraphEditor";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "" : "http://localhost:3001");

function resolveMediaUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/photos/") || url.startsWith("/avatars/")) return `${API_BASE}${url}`;
  return url;
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function Modal({ open, title, text, actions = [], onClose }) {
  if (!open) return null;
  return (
    <div className="admin-modal" onClick={onClose}>
      <div className="admin-modal__content" onClick={(e) => e.stopPropagation()}>
        <h3 className="admin-modal__title">{title}</h3>
        <p className="admin-modal__text" style={{ whiteSpace: "pre-line" }}>
          {text}
        </p>
        <div className="admin-modal__actions">
          {actions.length ? (
            actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={
                  "admin-modal__btn" + (a.variant === "danger" ? " admin-modal__btn--danger" : "")
                }
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))
          ) : (
            <button type="button" className="admin-modal__btn" onClick={onClose}>
              Окей
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

async function uploadFiles(files) {
  const fd = new FormData();
  Array.from(files || []).forEach((f) => fd.append("files", f));
  const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || "Не удалось загрузить файл");
  return data.urls || [];
}

export default function SubmitArticlePage() {
  const navigate = useNavigate();
  const location = useLocation();

  const editId = useMemo(() => {
    const q = new URLSearchParams(location.search);
    const v = Number(q.get("edit"));
    return Number.isFinite(v) ? v : null;
  }, [location.search]);

  const [user, setUser] = useState(null);

  const [title, setTitle] = useState("");

  // ✅ один HTML редактор
  const [contentHtml, setContentHtml] = useState("");
  const editorRef = useRef(null);

  // ✅ снимок исходного состояния (чтобы понять, редактировалось ли)
  const initialRef = useRef({ title: "", cover: "", html: "" });

  // cover
  const [coverImage, setCoverImage] = useState(""); // URL (для edit тоже)
  const [coverFile, setCoverFile] = useState(null); // File
  const [coverPreview, setCoverPreview] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [modal, setModal] = useState({ open: false, title: "", text: "", actions: [] });
  const closeModal = () => setModal((m) => ({ ...m, open: false }));

  // refs for tool buttons
  const coverInputRef = useRef(null);
  const imageInputRef = useRef(null);

  // ---- auth gate ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (!raw) {
        navigate("/login");
        return;
      }
      const u = JSON.parse(raw);
      if (!u?.login) {
        navigate("/login");
        return;
      }
      if (u.login === "admin") {
        navigate("/admin");
        return;
      }
      setUser(u);
    } catch {
      navigate("/login");
    }
  }, [navigate]);

  // ✅ init editor for NEW article (uncontrolled contentEditable)
  useEffect(() => {
    if (editId) return;
    if (!editorRef.current) return;

    const initHtml = "<p><br></p>";
    if (!editorRef.current.innerHTML || editorRef.current.innerHTML.trim() === "") {
      editorRef.current.innerHTML = initHtml;
      setContentHtml(initHtml);
    }

    // snapshot для новой статьи
    initialRef.current = { title: "", cover: "", html: initHtml };
  }, [editId]);

  // ---- load article for edit ----
  useEffect(() => {
    if (!editId || !user) return;

    const load = async () => {
      try {
        const q = new URLSearchParams({
          userId: String(user.id || ""),
          userLogin: user.login || "",
        });
        const res = await fetch(`${API_BASE}/api/articles/${editId}?${q.toString()}`);
        const data = await res.json();
        if (!data.ok) return;

        const t = data.article?.title || "";
        const c = data.article?.coverImage || "";

        setTitle(t);
        setCoverImage(c);
        setCoverFile(null);
        setCoverPreview(c ? resolveMediaUrl(c) : "");

        // blocks -> html
        const normalized = normalizeBlocks(data.article?.content || []);
        const html =
          normalized
            .map((b) => {
              if (b.type === "image") {
                const cap = b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : "";
                return `<figure><img src="${b.url}" />${cap}</figure>`;
              }
              if (b.type === "h2") return `<h2>${b.html || ""}</h2>`;
              if (b.type === "quote") return `<blockquote>${b.html || ""}</blockquote>`;
              return `<p>${b.html || ""}</p>`;
            })
            .join("") || "<p><br></p>";

        // ✅ ВАЖНО: редактор uncontrolled — вставляем в DOM напрямую
        setContentHtml(html);
        setTimeout(() => {
          if (editorRef.current) editorRef.current.innerHTML = html;
        }, 0);

        // ✅ snapshot для dirty-check
        initialRef.current = {
          title: t,
          cover: c,
          html,
        };
      } catch (e) {
        console.error(e);
      }
    };

    load();
  }, [editId, user]);

  // ---- helpers: cover pick/upload ----
  const onPickCover = (files) => {
    const f = files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      setModal({
        open: true,
        title: "Ошибка",
        text: "Выберите изображение (png/jpg/webp).",
        actions: [{ label: "Окей", onClick: closeModal }],
      });
      return;
    }

    if (coverPreview && coverPreview.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(coverPreview);
      } catch {}
    }

    setCoverFile(f);
    setCoverPreview(URL.createObjectURL(f));
  };

  const ensureCoverUploaded = async () => {
    if (!coverFile && coverImage) return coverImage;
    if (!coverFile) return "";
    const [url] = await uploadFiles([coverFile]);
    return url || "";
  };

  // ---- formatting ----
  const exec = (cmd, value = null) => {
    try {
      editorRef.current?.focus();
      document.execCommand(cmd, false, value);
      // только сохраняем state, НЕ рендерим обратно
      setTimeout(() => {
        setContentHtml(editorRef.current?.innerHTML || "");
      }, 0);
    } catch {}
  };

  const promptLink = () => {
    const url = window.prompt("Вставьте ссылку (https://...):", "https://");
    if (!url) return;
    exec("createLink", url);
  };

  // ---- вставка картинок в место курсора ----
  const insertImagesIntoEditor = async (files) => {
    const imgs = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return;

    try {
      setSubmitting(true);
      const urls = await uploadFiles(imgs);

      editorRef.current?.focus();

      urls.forEach((url) => {
        exec(
          "insertHTML",
          `<figure class="tg-figure"><img src="${url}" class="tg-img"/><figcaption class="tg-cap" contenteditable="true"></figcaption></figure><p><br></p>`
        );
      });

      setTimeout(() => {
        setContentHtml(editorRef.current?.innerHTML || "");
      }, 0);
    } catch (e) {
      setModal({
        open: true,
        title: "Ошибка",
        text: e.message || "Не удалось загрузить изображение",
        actions: [{ label: "Окей", onClick: closeModal }],
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ✅ dirty-check
  const isDirty = () => {
    const init = initialRef.current || { title: "", cover: "", html: "" };
    const currentHtml = (editorRef.current?.innerHTML || contentHtml || "").trim();
    const initHtml = String(init.html || "").trim();

    return (
      String(title || "").trim() !== String(init.title || "").trim() ||
      String(coverImage || "").trim() !== String(init.cover || "").trim() ||
      !!coverFile ||
      currentHtml !== initHtml
    );
  };

  // ---- save draft / submit ----
  const saveArticle = async (action) => {
    if (!user) {
      navigate("/login");
      return;
    }

    const safeTitle = String(title || "").trim();
    if (!safeTitle) {
      setModal({
        open: true,
        title: "Ошибка",
        text: "Введите заголовок.",
        actions: [{ label: "Окей", onClick: closeModal }],
      });
      return;
    }

    setSubmitting(true);
    try {
      const coverUrl = await ensureCoverUploaded();

      if (action === "submit" && !coverUrl) {
        setModal({
          open: true,
          title: "Нужна обложка",
          text:
            "Добавьте картинку, которая будет отображаться на сайте, как превью. Сделать это лучше всего между главным заголовком и текстом.",
          actions: [{ label: "Окей", onClick: closeModal }],
        });
        return;
      }

      const html = (editorRef.current?.innerHTML || contentHtml || "").trim() || "<p><br></p>";
      const content = [{ type: "p", html }];

      const payload = {
        title: safeTitle,
        coverImage: coverUrl || "",
        content,
        excerpt: buildExcerpt(content),
        action, // draft | submit
        userId: user.id,
        userLogin: user.login,
      };

      const method = editId ? "PUT" : "POST";
      const url = editId ? `${API_BASE}/api/articles/${editId}` : `${API_BASE}/api/articles`;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.ok) {
        if (data.code === "NO_COVER") {
          setModal({
            open: true,
            title: "Нужна обложка",
            text:
              "Добавьте картинку, которая будет отображаться на сайте, как превью. Сделать это лучше всего между главным заголовком и текстом.",
            actions: [{ label: "Окей", onClick: closeModal }],
          });
          return;
        }
        throw new Error(data.message || "Не удалось сохранить");
      }

      // ✅ после сохранения — обновляем snapshot, чтобы “Закрыть” не спрашивал снова
      initialRef.current = {
        title: safeTitle,
        cover: coverUrl || "",
        html,
      };
      setCoverImage(coverUrl || "");
      setCoverFile(null);

      if (action === "submit") {
        setModal({
          open: true,
          title: "Готово",
          text: "Ваша статья отправлена на модерацию, ожидайте публикации на сайте",
          actions: [
            {
              label: "Окей",
              onClick: () => {
                closeModal();
                navigate("/");
              },
            },
          ],
        });
      } else {
        setModal({
          open: true,
          title: "Черновик сохранён",
          text: "Статья сохранена как черновик в профиле.",
          actions: [
            {
              label: "Окей",
              onClick: () => {
                closeModal();
                navigate("/profile");
              },
            },
          ],
        });
      }
    } catch (e) {
      setModal({
        open: true,
        title: "Ошибка",
        text: e.message || "Ошибка",
        actions: [{ label: "Окей", onClick: closeModal }],
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ✅ правильный close
  const onCloseEditor = () => {
    // если нет изменений — просто уходим
    if (!isDirty()) {
      navigate(editId ? "/profile" : "/");
      return;
    }

    // если редактируем существующую — сохранить / не сохранять
    if (editId) {
      setModal({
        open: true,
        title: "Сохранить изменения?",
        text: "Вы изменили статью. Сохранить изменения?",
        actions: [
          { label: "Сохранить", onClick: () => saveArticle("draft") },
          {
            label: "Не сохранять",
            variant: "danger",
            onClick: () => {
              closeModal();
              navigate("/profile");
            },
          },
        ],
      });
      return;
    }

    // новая статья — удалить / в черновик
    setModal({
      open: true,
      title: "Закрыть редактор?",
      text:
        "Вы хотите удалить статью и выйти или сохранить, как черновик? Во втором случае статья сохранится черновиком в вашем профиле и вы сможете ее доработать, а потом уже - опубликовать.",
      actions: [
        {
          label: "Удалить",
          variant: "danger",
          onClick: () => {
            closeModal();
            navigate("/");
          },
        },
        {
          label: "В черновик",
          onClick: () => saveArticle("draft"),
        },
      ],
    });
  };

  const authorLabel = user?.login ? `@${user.login}` : "Автор";

  return (
    <>
      <section className="article-editor">
        <div className="container article-editor__inner">
          <header className="article-editor-top">
            <button
              type="button"
              className="article-editor-top__logo"
              onClick={() => (window.location.href = "/")}
              aria-label="На главную"
            >
              <img src="/logo3.svg" alt="ALLSPACE" />
            </button>

            <div className="article-editor-top__actions">
              <button
                type="button"
                className="article-editor-top__publish"
                onClick={() => saveArticle("submit")}
                disabled={submitting}
              >
                {submitting ? "Отправляем..." : "Опубликовать"}
              </button>
              <button type="button" className="article-editor-top__close" onClick={onCloseEditor}>
                Закрыть
              </button>
            </div>
          </header>

          <div className="article-editor-sheet">
            <input
              className="article-editor__title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Заголовок"
            />

            <div className="article-editor__author">{authorLabel}</div>

            <div className="article-editor-cover">
              {coverPreview ? (
                <img
                  src={resolveMediaUrl(coverPreview)}
                  alt=""
                  className="article-editor-cover__img"
                />
              ) : (
                <div className="article-editor-cover__placeholder">
                  <div className="article-editor-cover__ph-inner">
                    <span>Добавьте картинку превью</span>
                    <span className="article-editor-cover__ph-sub">
                      Лучше всего — между заголовком и текстом
                    </span>
                  </div>
                </div>
              )}

              <label className="article-editor-cover__pick">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => onPickCover(e.target.files)}
                  style={{ display: "none" }}
                />
                <img src="/camera-icon.svg" alt="" />
                <span>Добавить</span>
              </label>
            </div>

            <div className="article-editor-tools">
              <button
                type="button"
                className="article-editor-tools__btn"
                title="Подсказка"
                onClick={() => {
                  setModal({
                    open: true,
                    title: "Форматирование",
                    text:
                      "Выдели текст и используй:\n" +
                      "• Ctrl/Cmd + B — жирный\n" +
                      "• Ctrl/Cmd + I — курсив\n" +
                      "• Кнопка link — ссылка\n" +
                      "• Кнопка камера — вставить картинку",
                    actions: [{ label: "Окей", onClick: closeModal }],
                  });
                }}
              >
                <span className="article-editor-tools__texticon">&lt;&gt;</span>
              </button>

              <button
                type="button"
                className="article-editor-tools__btn"
                title="Ссылка"
                onClick={promptLink}
              >
                <img src="/link-icon.svg" alt="" />
              </button>

              <button
                type="button"
                className="article-editor-tools__btn"
                title="Жирный"
                onClick={() => exec("bold")}
              >
                <b>B</b>
              </button>

              <button
                type="button"
                className="article-editor-tools__btn"
                title="Курсив"
                onClick={() => exec("italic")}
              >
                <i>I</i>
              </button>

              <button
                type="button"
                className="article-editor-tools__btn"
                title="Картинка"
                onClick={() => imageInputRef.current?.click()}
              >
                <img src="/camera-icon.svg" alt="" />
              </button>

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = e.target.files;
                  e.target.value = "";
                  insertImagesIntoEditor(files);
                }}
              />
            </div>

            {/* ✅ редактор uncontrolled (фиксит “задом наперед”) */}
            <div
              ref={editorRef}
              className="article-editor-rich"
              contentEditable
              suppressContentEditableWarning
              onInput={() => setContentHtml(editorRef.current?.innerHTML || "")}
              onClick={() => editorRef.current?.focus()}
            />
          </div>
        </div>
      </section>

      <Modal
        open={modal.open}
        title={modal.title}
        text={modal.text}
        actions={modal.actions}
        onClose={closeModal}
      />
    </>
  );
}