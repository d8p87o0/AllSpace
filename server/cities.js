// server/cities.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.resolve(__dirname, "city.csv");

let cities = [];

function loadCities() {
  try {
    const csv = fs.readFileSync(csvPath, "utf8");

    // аккуратно парсим CSV с учётом кавычек и запятых внутри
    const records = parse(csv, {
      columns: true,          // первая строка — заголовки
      skip_empty_lines: true,
      trim: true,
    });

    const seen = new Set();
    const result = [];

    for (const rec of records) {
      // пробуем взять город из city
      let name = (rec.city || "").trim();

      // если city пустой — пытаемся восстановить
      if (!name) {
        const regionType = (rec.region_type || "").trim().toLowerCase();
        const region = (rec.region || "").trim();
        const cityType = (rec.city_type || "").trim().toLowerCase();
        const settlement = (rec.settlement || "").trim();
        const address = (rec.address || "").trim();

        // 1) Москва, Санкт-Петербург и похожие:
        //    region_type = "г", region = "Москва"
        if (!name && regionType.startsWith("г") && region) {
          name = region;
        }

        // 2) Иногда населённый пункт в settlement при заданном city_type
        if (!name && cityType.startsWith("г") && settlement) {
          name = settlement;
        }

        // 3) В крайнем случае пробуем вытащить город из конца address
        if (!name && address) {
          // берём последнюю часть после запятой
          const lastComma = address.lastIndexOf(",");
          let lastPart =
            lastComma >= 0 ? address.slice(lastComma + 1) : address;
          lastPart = lastPart.trim();

          // убираем приставку "г " / "г." в начале
          lastPart = lastPart.replace(/^г\.?\s+/i, "");
          if (lastPart) {
            name = lastPart;
          }
        }
      }

      if (!name) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        name,
        lower: key,
      });
    }

    cities = result;
    console.log(`Загружено ${cities.length} уникальных городов`);
  } catch (err) {
    console.error("Ошибка загрузки city.csv:", err);
  }
}

loadCities();

/**
 * Подсказки по введённой строке:
 * ищем города, которые НАЧИНАЮТСЯ с этого текста
 */
export function suggestCities(query, limit = 10) {
  if (!query) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return cities
    .filter((c) => c.lower.startsWith(q))
    .slice(0, limit)
    .map((c) => c.name);
}

/**
 * Проверка, существует ли город (полное совпадение по имени)
 */
export function cityExists(name) {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return cities.some((c) => c.lower === n);
}
