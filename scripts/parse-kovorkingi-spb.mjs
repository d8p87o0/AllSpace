import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://www.kovorkingi.ru";
const CITY_PATH = "/kovorking/city/sankt-peterburg";
const CITY_NAME = "Санкт-Петербург";
const OUTPUT_PATH = path.resolve(__dirname, "../server/parsed/kovorkingi-spb.json");
const REQUEST_DELAY_MS = 250;
const SECTION_TITLES = [
  "Контакты коворкинга",
  "Часы работы",
  "Ближайшие станции метро",
  "На карте",
  "Отзывы о",
  "Тарифы на аренду",
  "Похожие коворкинги",
  "Ближайшие коворкинги",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();

    if (lower === "nbsp") return " ";
    if (lower === "amp") return "&";
    if (lower === "quot") return '"';
    if (lower === "apos" || lower === "#39") return "'";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";

    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    return match;
  });
}

function stripTags(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(value || "")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<(?:br|\/p|\/div|\/section|\/article|\/li|\/ul|\/ol|\/h\d|\/tr|\/table)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function htmlToLines(html) {
  return stripTags(html)
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanName(rawName) {
  const name = normalizeWhitespace(rawName);
  return name
    .replace(/^Коворкинг\s+/i, "")
    .replace(/^[`"'«»]+|[`"'«»]+$/g, "")
    .trim();
}

function extractName(html, lines) {
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const h1Text = cleanName(stripTags(h1Match[1]));
    if (h1Text) return h1Text;
  }

  const line = lines.find((value) => value.startsWith("Коворкинг ")) || "";
  return cleanName(line);
}

function isSectionLine(line) {
  return SECTION_TITLES.some((title) => line.startsWith(title));
}

function sanitizeTextLine(line) {
  return normalizeWhitespace(line)
    .replace(/^"+|"+$/g, "")
    .replace(/\s+\|\s+/g, " | ");
}

function isNoiseLine(line, name) {
  if (!line) return true;
  if (line === name || line === `Коворкинг ${name}`) return true;
  if (/^(Поделиться|Забронировать|Выбрать тариф|Подобрать офис|Оставить отзыв|Показать на карте|Добавить пространство|Вход)$/i.test(line)) {
    return true;
  }
  if (/^(Все пространства для работы|Главная|Коворкинги России|Коворкинги Санкт-Петербурга|Аренда офисов|Бизнес-центры|Коворкинги|Реклама|Консатлинг)$/i.test(line)) {
    return true;
  }
  if (/^\d+(?:\/\d+)?$/.test(line)) return true;
  if (/^\d+\s+отзыв/i.test(line)) return true;
  if (/^[\d.,]+$/.test(line)) return true;
  if (line.length < 10) return true;
  return false;
}

function extractDescription(lines, name) {
  const amenitiesIndex = lines.findIndex((line) => line === "Удобства в коворкинге");
  if (amenitiesIndex <= 0) return null;
  const nameIndex = lines.findIndex((line) => line === `Коворкинг ${name}` || line === name);
  const startIndex = nameIndex >= 0 ? nameIndex + 1 : 0;
  const parts = [];

  for (let index = startIndex; index < amenitiesIndex; index += 1) {
    const line = sanitizeTextLine(lines[index]);
    if (isNoiseLine(line, name)) continue;
    if (line.includes("Коворкинг")) continue;
    if (/^(Показать больше|Закрыть|Фото|Логотип|Ещё \d+ фото|\+\d+)$/i.test(line)) {
      if (parts.length) break;
      continue;
    }
    if (/^\d+\/\d+$/.test(line)) {
      if (parts.length) break;
      continue;
    }
    if (line.startsWith("»")) {
      if (parts.length) break;
      continue;
    }
    if (/^Адрес\s*:?/i.test(line) || isSectionLine(line)) break;
    if (line.length < 20) {
      if (parts.length) break;
      continue;
    }
    parts.push(line);
  }

  return parts.length ? parts.join("\n\n") : null;
}

function extractSectionLines(lines, startTitle, endMatcher) {
  const startIndex = lines.findIndex((line) => line === startTitle);
  if (startIndex < 0) return [];

  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = sanitizeTextLine(lines[index]);
    if (!line) continue;
    if (endMatcher(line)) break;
    collected.push(line);
  }
  return collected;
}

function extractAddress(lines) {
  const addressLine = lines.find((line) => /^Адрес\s*:\s*/i.test(line));
  if (addressLine) {
    return normalizeWhitespace(addressLine.replace(/^Адрес\s*:\s*/i, ""));
  }

  const contactLines = extractSectionLines(
    lines,
    "Контакты коворкинга",
    (line) => line === "Часы работы" || isSectionLine(line)
  );

  return contactLines.find((line) => !/^(Выбрать тариф|Подобрать офис)$/i.test(line)) || null;
}

function extractPhone(lines) {
  const phoneLine = lines.find((line) => /^(Телефон|Тел\.|Контактный телефон):/i.test(line));
  if (!phoneLine) return null;
  return normalizeWhitespace(phoneLine.replace(/^(Телефон|Тел\.|Контактный телефон):/i, ""));
}

function extractHours(lines) {
  const values = extractSectionLines(
    lines,
    "Часы работы",
    (line) => line === "Ближайшие станции метро" || isSectionLine(line)
  ).filter((line) => !/^(Выбрать тариф|Подобрать офис)$/i.test(line));

  return values.length ? values.join("\n") : null;
}

function extractFeatures(lines) {
  const values = extractSectionLines(
    lines,
    "Удобства в коворкинге",
    (line) => line === "Контакты коворкинга" || isSectionLine(line)
  )
    .filter((line) => !/^(Показать больше|Закрыть|Фото|Логотип)$/i.test(line))
    .filter((line) => !/^\d+\/\d+$/.test(line))
    .filter((line) => line.length <= 80);

  return uniq(values);
}

function extractImageUrls(html, pageUrl) {
  const matches = [...html.matchAll(/<(?:img|source)\b[^>]+(?:data-src|src)=["']([^"'#?]+(?:\.(?:jpe?g|png|webp|gif|avif))(?:\?[^"']*)?)["']/gi)];

  const blocked = [
    "logo",
    "icon",
    "favicon",
    "metro",
    "wifi",
    "coffee",
    "print",
    "cafe",
    "park-zone",
    "food",
    "events",
    "test-day",
    "org-address",
    "currency",
    "close",
    "menu",
    "rating",
    "star",
    "map",
    "telegram",
    "vk",
    "whatsapp",
    "youtube",
    "rutube",
    "banner",
    "placeholder",
    "avatar",
    "office_tariffs",
    "/data/files/tariffs/",
    "noimage",
    "no-photo",
  ];

  const urls = matches
    .map((match) => match[1])
    .map((rawUrl) => {
      try {
        return new URL(rawUrl, pageUrl).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((url) => {
      const lower = url.toLowerCase();
      return !blocked.some((token) => lower.includes(token));
    });

  return uniq(urls);
}

function collectDetailUrls(html) {
  const matches = [...html.matchAll(/href=["']([^"']+)["']/gi)];
  const urls = matches
    .map((match) => match[1])
    .map((rawUrl) => {
      try {
        return new URL(rawUrl, BASE_URL).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((url) => url.startsWith(`${BASE_URL}/kovorking/`))
    .filter((url) => !url.includes("/kovorking/city/"))
    .filter((url) => !url.includes("/kovorking/metro/"))
    .filter((url) => !/\/page\/\d+\/?$/i.test(url))
    .map((url) => url.replace(/#.*$/, "").replace(/\/+$/, ""));

  return uniq(urls);
}

function collectPageCount(html) {
  const matches = [...html.matchAll(/href=["'][^"']*\/kovorking\/city\/sankt-peterburg(?:\/page\/(\d+))?\/?["']/gi)];
  const pages = matches
    .map((match) => Number.parseInt(match[1] || "1", 10))
    .filter((value) => Number.isInteger(value));

  return pages.length ? Math.max(...pages) : 1;
}

async function fetchHtml(url, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error(`Too many redirects for ${url}`);
  }

  const client = url.startsWith("https:") ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(
      url,
      {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
          "accept-encoding": "identity",
        },
      },
      async (response) => {
        const status = response.statusCode || 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          try {
            const redirectedUrl = new URL(response.headers.location, url).href;
            const html = await fetchHtml(redirectedUrl, redirectCount + 1);
            resolve(html);
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );

    request.setTimeout(30000, () => {
      request.destroy(new Error(`Timeout for ${url}`));
    });

    request.on("error", reject);
  });
}

function extractReviewsCount(lines) {
  const line = lines.find((value) => /\d+\s+отзыв/i.test(value));
  if (!line) return null;
  const match = line.match(/(\d+)\s+отзыв/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function extractRating(lines) {
  const reviewsIndex = lines.findIndex((line) => /\d+\s+отзыв/i.test(line));
  if (reviewsIndex <= 0) return null;

  for (let index = reviewsIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/^\d+(?:[.,]\d+)?$/.test(line)) {
      return Number.parseFloat(line.replace(",", "."));
    }
  }

  return null;
}

function toPlaceRecord(pageUrl, html) {
  const lines = htmlToLines(html);
  const name = extractName(html, lines);
  const description = extractDescription(lines, name);
  const images = extractImageUrls(html, pageUrl);

  if (!name || !description || images.length === 0) {
    return null;
  }

  return {
    name,
    type: "Коворкинг",
    city: CITY_NAME,
    address: extractAddress(lines),
    image: images[0],
    images,
    badge: null,
    rating: extractRating(lines),
    reviews: extractReviewsCount(lines),
    features: extractFeatures(lines),
    link: pageUrl,
    sourceUrl: pageUrl,
    description,
    hours: extractHours(lines),
    phone: extractPhone(lines),
  };
}

async function main() {
  const firstPageUrl = `${BASE_URL}${CITY_PATH}`;
  const firstHtml = await fetchHtml(firstPageUrl);
  const pageCount = collectPageCount(firstHtml);
  const detailUrls = new Set(collectDetailUrls(firstHtml));

  for (let page = 2; page <= pageCount; page += 1) {
    await sleep(REQUEST_DELAY_MS);
    const pageUrl = `${BASE_URL}${CITY_PATH}/page/${page}`;
    const html = await fetchHtml(pageUrl);
    for (const url of collectDetailUrls(html)) {
      detailUrls.add(url);
    }
  }

  const places = [];
  for (const url of detailUrls) {
    await sleep(REQUEST_DELAY_MS);
    try {
      const html = await fetchHtml(url);
      const place = toPlaceRecord(url, html);
      if (place) {
        places.push(place);
      }
    } catch (error) {
      console.error(`Failed to parse ${url}:`, error.message);
    }
  }

  const payload = {
    source: `${BASE_URL}${CITY_PATH}`,
    city: CITY_NAME,
    generatedAt: new Date().toISOString(),
    totalFound: detailUrls.size,
    totalIncluded: places.length,
    places: places.sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Saved ${places.length} places to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
