// src/ArticlePage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./App.css";
import SEO, { SEO_SITE_URL } from "./SEO.jsx";
import { API_BASE } from "./api.js";

function formatDateFromUnix(sec) {
  if (!sec) return "";
  const d = new Date(Number(sec) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  }

function resolveMediaUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/photos/") || url.startsWith("/avatars/")) return `${API_BASE}${url}`;
  return url;
}

function Modal({ open, title, text, actions = [], onClose }) {
  if (!open) return null;
  return (
    <div className="admin-modal" onClick={onClose}>
      <div className="admin-modal__content" onClick={(e) => e.stopPropagation()}>
        <h3 className="admin-modal__title">{title}</h3>
        <p className="admin-modal__text">{text}</p>
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

export default function ArticlePage() {
  const { id } = useParams();
  const articleId = Number(id);
  const navigate = useNavigate();

  const [user, setUser] = useState(null);

  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [favCount, setFavCount] = useState(0);
  const [isFav, setIsFav] = useState(false);

  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState("");

  const [modal, setModal] = useState({ open: false, title: "", text: "", actions: [] });
  const closeModal = () => setModal((m) => ({ ...m, open: false }));

  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      setUser(raw ? JSON.parse(raw) : null);
    } catch {
      setUser(null);
    }
  }, []);

  const viewerQuery = useMemo(() => {
    if (!user) return "";
    const q = new URLSearchParams({
      userId: String(user.id || ""),
      userLogin: user.login || "",
    });
    return `?${q.toString()}`;
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`${API_BASE}/api/articles/${articleId}${viewerQuery}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Не удалось загрузить статью");
        if (!cancelled) {
          setArticle(data.article);
        }

        // 1) fav count
        const f = await fetch(`${API_BASE}/api/articles/${articleId}/favorite-count`);
        const fd = await f.json();
        if (!cancelled && fd.ok) setFavCount(fd.count || 0);

        // 2) isFav (только если есть юзер)
        if (user) {
        const s = await fetch(
            `${API_BASE}/api/articles/${articleId}/favorite-state?userId=${user.id}&userLogin=${encodeURIComponent(user.login)}`
        );
        const sd = await s.json();
        if (!cancelled && sd.ok) setIsFav(!!sd.isFav);
        } else {
        if (!cancelled) setIsFav(false);
        }

        const c = await fetch(`${API_BASE}/api/articles/${articleId}/comments`);
        const cd = await c.json();
        if (!cancelled && cd.ok) setComments(cd.comments || []);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Ошибка");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (Number.isFinite(articleId)) load();
    return () => {
      cancelled = true;
    };
  }, [articleId, viewerQuery]);

  const toggleFavorite = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (user.login === "admin") {
      setModal({
        open: true,
        title: "Недоступно",
        text: "Администратор не может добавлять в избранное.",
        actions: [],
      });
      return;
    }

    try {
      const method = isFav ? "DELETE" : "POST";
      const res = await fetch(`${API_BASE}/api/articles/${articleId}/favorite`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, userLogin: user.login }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Ошибка");

      const f = await fetch(`${API_BASE}/api/articles/${articleId}/favorite-count`);
      const fd = await f.json();
      if (fd.ok) setFavCount(fd.count || 0);

      setIsFav((p) => !p);
    } catch (e) {
      setModal({ open: true, title: "Ошибка", text: e.message || "Не удалось", actions: [] });
    }
  };

  const submitComment = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    const text = commentText.trim();
    if (!text) {
      setCommentError("Введите текст комментария");
      return;
    }

    try {
      setCommentError("");
      const res = await fetch(`${API_BASE}/api/articles/${articleId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, userId: user.id, userLogin: user.login }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Не удалось отправить");
      setCommentText("");

      const c = await fetch(`${API_BASE}/api/articles/${articleId}/comments`);
      const cd = await c.json();
      if (cd.ok) setComments(cd.comments || []);
    } catch (e) {
      setCommentError(e.message || "Ошибка");
    }
  };

  if (loading) {
    return (
      <section className="article-page">
        <div className="container article-page__inner">
          <p>Загружаем статью...</p>
        </div>
      </section>
    );
  }

  if (!article) {
    return (
      <section className="article-page">
        <div className="container article-page__inner">
          <p>{err || "Статья не найдена"}</p>
        </div>
      </section>
    );
  }

  const authorLine = article.authorLogin ? `@${article.authorLogin}` : "Автор";
  const publishedLine = formatDateFromUnix(article.publishedAt || article.createdAt);

  const articleTitle = article?.title
  ? `${article.title} — ALLSPACE`
  : "Статья — ALLSPACE";

  const articleDescription =
    article?.excerpt ||
    article?.description ||
    "Статья ALLSPACE о фрилансе, удалённой работе и продуктивности.";

  const articleImage = article?.coverImage
    ? (article.coverImage.startsWith("http")
        ? article.coverImage
        : `${SEO_SITE_URL}${article.coverImage}`)
    : `${SEO_SITE_URL}/og-default.jpg`;

  const articleUrl = `${SEO_SITE_URL}/article/${article?.id || ""}`;

  return (
    <>
      <SEO
        title={articleTitle}
        description={articleDescription}
        canonical={articleUrl}
        ogTitle={articleTitle}
        ogDescription={articleDescription}
        ogImage={articleImage}
        ogUrl={articleUrl}
        type="article"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article?.title || "Статья",
          description: articleDescription,
          image: [articleImage],
          author: {
            "@type": "Person",
            name: article?.authorName || article?.authorLogin || "Автор",
          },
          publisher: {
            "@type": "Organization",
            name: "ALLSPACE",
            logo: {
              "@type": "ImageObject",
              url: `${SEO_SITE_URL}/logo3.svg`,
            },
          },
          datePublished: article?.publishedAt
            ? new Date(Number(article.publishedAt) * 1000).toISOString()
            : article?.createdAt
            ? new Date(article.createdAt).toISOString()
            : undefined,
          dateModified: article?.updatedAt
            ? new Date(article.updatedAt).toISOString()
            : article?.createdAt
            ? new Date(article.createdAt).toISOString()
            : undefined,
          mainEntityOfPage: articleUrl,
        }}
      />
      <section className="article-page">
        <div className="container article-page__inner">
          {/* top bar like telegra */}
          <div className="article-topbar">
            <button
              type="button"
              className="article-topbar__logo"
              onClick={() => (window.location.href = "/")}
              aria-label="На главную"
            >
              <img src="/logo3.svg" alt="ALLSPACE" />
            </button>

            <div className="article-topbar__right">
              <button
                type="button"
                className={"article-fav-btn" + (isFav ? " article-fav-btn--active" : "")}
                onClick={toggleFavorite}
              >
                {isFav ? `В избранном (${favCount})` : `В избранное (${favCount})`}
              </button>
            </div>
          </div>

          {/* content */}
          <div className="article-sheet">
            <h1 className="article-sheet__title">{article.title || "Без названия"}</h1>
            <div className="article-sheet__meta">
              <span>{authorLine}</span>
              {publishedLine ? <span className="article-sheet__dot">•</span> : null}
              {publishedLine ? <span>{publishedLine}</span> : null}
            </div>

            {article.coverImage ? (
              <div className="article-sheet__cover">
                <img src={resolveMediaUrl(article.coverImage)} alt="" />
              </div>
            ) : null}

            <div className="article-sheet__content">
              {(article.content || []).map((b, idx) => {
                if (b.type === "image") {
                  return (
                    <figure key={idx} className="article-figure">
                      <img src={resolveMediaUrl(b.url)} alt="" className="article-figure__img" />
                      {b.caption ? <figcaption className="article-figure__cap">{b.caption}</figcaption> : null}
                    </figure>
                  );
                }

                if (b.type === "h2") {
                  return (
                    <h2
                      key={idx}
                      className="article-h2"
                      dangerouslySetInnerHTML={{ __html: b.html || "" }}
                    />
                  );
                }

                if (b.type === "quote") {
                  return (
                    <blockquote
                      key={idx}
                      className="article-quote"
                      dangerouslySetInnerHTML={{ __html: b.html || "" }}
                    />
                  );
                }

                return (
                  <p key={idx} className="article-p" dangerouslySetInnerHTML={{ __html: b.html || "" }} />
                );
              })}
            </div>

            {/* comments */}
            <div className="article-comments">
              <h2 className="article-comments__title">Комментарии</h2>

              <div className="article-comments__form">
                <textarea
                  className="article-comments__textarea"
                  placeholder="Написать комментарий..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                />
                {commentError ? <div className="article-comments__error">{commentError}</div> : null}
                <button type="button" className="article-comments__send" onClick={submitComment}>
                  Отправить
                </button>
              </div>

              <div className="article-comments__list">
                {comments.map((c) => (
                  <div key={c.id} className="article-comment">
                    <div className="article-comment__avatar">
                      {c.userAvatar ? (
                        <img
                          src={resolveMediaUrl(c.userAvatar)}
                          alt={c.userName || c.userLogin || "Гость"}
                          className="article-comment__avatar-img"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        (c.userName || c.userLogin || "U").slice(0, 2).toUpperCase()
                      )}
                    </div>

                    <div className="article-comment__body">
                      <div className="article-comment__head">
                        <span className="article-comment__name">
                          {c.userName || c.userLogin || "Гость"}
                        </span>
                        <span className="article-comment__date">{formatDate(c.createdAt)}</span>
                      </div>
                      <div className="article-comment__text">{c.text}</div>
                    </div>
                  </div>
                ))}
                {!comments.length ? <p className="article-comments__empty">Комментариев пока нет.</p> : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Modal open={modal.open} title={modal.title} text={modal.text} actions={modal.actions} onClose={closeModal} />
    </>
  );
}
