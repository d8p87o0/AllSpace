import sqlite3pkg from "sqlite3";

const sqlite3 = sqlite3pkg.verbose();
const db = new sqlite3.Database("server/users.db");

const REQUEST_DELAY_MS = 450;
const RETRY_DELAY_MS = 1800;
const MAX_ATTEMPTS = 4;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const GEOCODER_USER_AGENT = "AllSpaceGeocoder/1.0 (local-dev)";
const MANUAL_COORDINATES_BY_ID = {
  104: { latitude: 55.817548, longitude: 37.655793 },
  137: { latitude: 55.762586, longitude: 37.626784 },
  165: { latitude: 55.75754, longitude: 37.634735 },
  187: { latitude: 55.75734, longitude: 37.632838 },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function extractCoordinates(html) {
  const patterns = [
    /"displayCoordinates"\s*:\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/i,
    /"coordinates"\s*:\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    const longitude = Number(match[1]);
    const latitude = Number(match[2]);

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  return null;
}

function isCaptchaPage(html) {
  return /Подтвердите, что запросы отправляли вы/i.test(html);
}

function normalizeAddress(address) {
  return String(address || "")
    .replace(/\bд\.\s*/gi, "")
    .replace(/\bстр\.\s*/gi, "с")
    .replace(/\bстроение\s*/gi, "с")
    .replace(/\bэтаж\s*\d+[-\d]*/gi, "")
    .replace(/\bофис\s*[0-9а-яa-z-]+/gi, "")
    .replace(/\bподъезд\s*\d+/gi, "")
    .replace(/\bцокольный этаж\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/g, "")
    .trim();
}

async function fetchCoordsFromYandexOrg(link, attempt = 1) {
  if (!link || !/yandex\.ru\/maps\/org\//i.test(link)) return null;

  const res = await fetch(link, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const html = await res.text();
  if (isCaptchaPage(html)) {
    if (attempt >= MAX_ATTEMPTS) return null;
    await sleep(RETRY_DELAY_MS * attempt);
    return fetchCoordsFromYandexOrg(link, attempt + 1);
  }

  const coords = extractCoordinates(html);
  if (coords) return coords;

  if (attempt >= MAX_ATTEMPTS) return null;
  await sleep(RETRY_DELAY_MS * attempt);
  return fetchCoordsFromYandexOrg(link, attempt + 1);
}

async function geocodeByAddress(address, city = "Москва", attempt = 1) {
  const normalized = normalizeAddress(address);
  const query = [normalized, city, "Россия"].filter(Boolean).join(", ");
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ru&q=" +
    encodeURIComponent(query);

  const res = await fetch(url, {
    headers: {
      "User-Agent": GEOCODER_USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Geocoder HTTP ${res.status}`);
  }

  const data = await res.json();
  const first = Array.isArray(data) ? data[0] : null;
  if (!first) {
    if (attempt >= 2) return null;
    await sleep(RETRY_DELAY_MS);
    return geocodeByAddress(address, city, attempt + 1);
  }

  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

async function main() {
  await dbRun("ALTER TABLE places ADD COLUMN latitude REAL").catch(() => {});
  await dbRun("ALTER TABLE places ADD COLUMN longitude REAL").catch(() => {});

  const places = await dbAll(
    `SELECT id, name, city, address, link
     FROM places
     WHERE hex(city) = 'D09CD0BED181D0BAD0B2D0B0'
       AND (latitude IS NULL OR longitude IS NULL)
       AND link LIKE '%yandex.ru/maps/org/%'
     ORDER BY id`
  );

  let updated = 0;
  let skipped = 0;

  for (const place of places) {
    try {
      const coords =
        MANUAL_COORDINATES_BY_ID[Number(place.id)] ||
        (await fetchCoordsFromYandexOrg(String(place.link || "").trim())) ||
        (await geocodeByAddress(place.address, place.city));
      if (!coords) {
        skipped += 1;
      } else {
        await dbRun("UPDATE places SET latitude = ?, longitude = ? WHERE id = ?", [
          coords.latitude,
          coords.longitude,
          place.id,
        ]);
        updated += 1;
      }
    } catch (error) {
      skipped += 1;
      console.error(`Coordinate fetch failed for ${place.id} ${place.name}: ${error.message}`);
    }

    if ((updated + skipped) % 10 === 0) {
      console.log(`progress ${updated + skipped}/${places.length}`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(JSON.stringify({ total: places.length, updated, skipped }, null, 2));
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
