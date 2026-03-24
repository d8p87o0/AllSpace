const rawApiBase =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD ? "" : "http://localhost:3001");

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");

  if (!trimmed || trimmed === "/") {
    return "";
  }

  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

export const API_BASE = normalizeApiBase(rawApiBase);

export async function readJsonResponse(res, label = "API request") {
  const text = await res.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 140);
    const hint = preview.startsWith("<")
      ? "Сервер вернул HTML вместо JSON. Проверь VITE_API_BASE и proxy/nginx."
      : preview || "Пустой или некорректный ответ.";

    throw new Error(`${label}: ожидался JSON, получен другой ответ (${res.status}). ${hint}`);
  }
}
