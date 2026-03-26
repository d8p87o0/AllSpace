import fs from "node:fs";
import sqlite3pkg from "sqlite3";

const sqlite3 = sqlite3pkg.verbose();
const db = new sqlite3.Database("server/users.db");
const REQUEST_DELAY_MS = 700;

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      i += 1;
      continue;
    }

    if (ch === "\r") {
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  return body
    .filter((item) => item.length >= header.length)
    .map((item) => Object.fromEntries(header.map((key, idx) => [key, item[idx] || ""])));
}

function normalizeName(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanDescription(raw) {
  let text = String(raw || "")
    .replace(/^Ещё фото\d+\s*\|\s*/i, "")
    .replace(/🌟|📚✨|✨|📚|☕|🚀|🔥/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const cutMarkers = [
    " | Плюсы:",
    " | Подходит для:",
    " | Kowo рекомендует",
    " | var myMap",
    "Что бы получить постоянную скидку",
    "Чтобы получить постоянную скидку",
  ];

  for (const marker of cutMarkers) {
    const idx = text.indexOf(marker);
    if (idx >= 0) {
      text = text.slice(0, idx).trim();
    }
  }

  text = text
    .replace(/Также в данном пространстве есть/gi, "Здесь также есть")
    .replace(/В данном пространстве есть/gi, "Здесь есть")
    .replace(/Данное пространство/gi, "Это пространство")
    .replace(/Бизнес-центр [^—-]+[—-]\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  let result = sentences.slice(0, 3).join(" ").trim();
  if (!result) {
    result = text;
  }

  if (result.length > 380) {
    result = `${result.slice(0, 377).trimEnd()}...`;
  }

  return result;
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "—")
    .replace(/&laquo;|&raquo;/gi, '"')
    .replace(/&quot;/gi, '"')
    .replace(/&#8212;/g, "—")
    .replace(/&#171;|&#187;/g, '"')
    .replace(/&#[0-9]+;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractDescriptionFromHtml(html) {
  const blockMatch = html.match(/<div class="input_tinymce">([\s\S]*?)<\/div>\s*<\/div>/i);
  const block = blockMatch ? blockMatch[1] : "";
  if (!block) return "";

  const paragraphs = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean)
    .filter((text) => !/^(для кого подходит|для каких ситуаций|плюсы|тарифы|минусы)\s*:?\s*$/i.test(text));

  const combined = paragraphs.slice(0, 2).join(" ");
  return cleanDescription(combined);
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function main() {
  const csv = fs.readFileSync("server/kowo_full.csv", "utf8");
  const sourceRows = parseCsv(csv);
  const sourceByName = new Map();
  const jsonRows = JSON.parse(fs.readFileSync("server/kowo_full.json", "utf8"));
  const urlByName = new Map();

  for (const row of sourceRows) {
    const key = normalizeName(row.name);
    const description = cleanDescription(row.description);
    if (key && description) {
      sourceByName.set(key, description);
    }
  }

  for (const row of jsonRows) {
    const key = normalizeName(row.name);
    if (key && row.url) {
      urlByName.set(key, String(row.url).trim());
    }
  }

  const places = await dbAll(
    "SELECT id, name, city, description FROM places WHERE hex(city) = 'D09CD0BED181D0BAD0B2D0B0' ORDER BY id"
  );
  const updates = [];
  const fromWeb = [];

  for (const place of places) {
    if (String(place.description || "").trim()) continue;

    const key = normalizeName(place.name);
    let description = sourceByName.get(key) || "";

    if (!description) {
      const url = urlByName.get(key);
      if (url) {
        try {
          const html = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              Accept: "text/html,application/xhtml+xml",
            },
          }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          });

          description = extractDescriptionFromHtml(html);
          if (description) {
            fromWeb.push(place.name);
          }
        } catch {}
        await sleep(REQUEST_DELAY_MS);
      }
    }

    if (!description) continue;

    updates.push({ id: place.id, name: place.name, description });
  }

  await dbRun("BEGIN TRANSACTION");
  try {
    for (const item of updates) {
      await dbRun("UPDATE places SET description = ? WHERE id = ?", [
        item.description,
        item.id,
      ]);
    }
    await dbRun("COMMIT");
  } catch (error) {
    await dbRun("ROLLBACK").catch(() => {});
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        totalSources: sourceRows.length,
        totalJsonSources: jsonRows.length,
        updated: updates.length,
        updatedFromWeb: fromWeb.length,
        sample: updates.slice(0, 20).map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
        })),
      },
      null,
      2
    )
  );

  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
