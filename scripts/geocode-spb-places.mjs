import fs from "node:fs/promises";
import sqlite3pkg from "sqlite3";

const sqlite3 = sqlite3pkg.verbose();
const db = new sqlite3.Database("server/users.db");

const USER_AGENT = "AllSpaceGeocoder/1.0 (local-dev)";
const REQUEST_DELAY_MS = 1200;
const MANUAL_COORDINATES = {
  prostorcoworkingевпаторийский: { latitude: 59.963594, longitude: 30.339003 },
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

function buildQuery(place) {
  const name = String(place.name || "").trim();
  const address = String(place.address || "").trim();
  const city = String(place.city || "").trim();
  return [name, address, city].filter(Boolean).join(", ");
}

function normalizeAddress(address) {
  return String(address || "")
    .replace(/^Россия,\s*/i, "")
    .replace(/^г\.\s*/i, "")
    .replace(/^город\s+/i, "")
    .replace(/^Санкт-Петербург,\s*/i, "")
    .replace(/^Муниципальный округ[^,]*,\s*/i, "")
    .replace(/^БЦ\s+[^,]+,\s*/i, "")
    .replace(/\bпр-т\b/gi, "проспект")
    .replace(/\bул\.\b/gi, "улица")
    .replace(/\bпер\.\b/gi, "переулок")
    .replace(/\bнаб\.\b/gi, "набережная")
    .replace(/\bстр\.\s*\d*/gi, "")
    .replace(/\bк\.\s*\d*/gi, "")
    .replace(/\bкорпус\s*\d+[А-Яа-яA-Za-z-]*/gi, "")
    .replace(/\bлит\.?\s*[А-Яа-яA-Za-z-]*/gi, "")
    .replace(/\bлитер\s*[А-Яа-яA-Za-z-]*/gi, "")
    .replace(/\bофис\s*\d+[А-Яа-яA-Za-z-]*/gi, "")
    .replace(/\bэтаж\s*\d+[А-Яа-яA-Za-z-]*/gi, "")
    .replace(/\bпомещение\s*[0-9А-Яа-яA-Za-z-]*/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/g, "")
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

async function loadSourceMap() {
  const raw = await fs.readFile("server/parsed/kovorkingi-spb.json", "utf8");
  const payload = JSON.parse(raw);
  const places = Array.isArray(payload?.places) ? payload.places : [];
  const byName = new Map();

  for (const place of places) {
    const key = normalizeName(place.name);
    if (key && place.sourceUrl && !byName.has(key)) {
      byName.set(key, String(place.sourceUrl).trim());
    }
  }

  return byName;
}

async function fetchCoordsFromEmbed(sourceUrl) {
  if (!sourceUrl) return null;

  const embedUrl = `${String(sourceUrl).replace(/\/+$/, "")}/map/embed`;
  const html = await fetch(embedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
    },
  }).then((res) => {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.text();
  });

  const placemarkMatch = html.match(/Placemark\(\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/i);
  if (placemarkMatch) {
    const latitude = Number(placemarkMatch[1]);
    const longitude = Number(placemarkMatch[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  const centerMatch = html.match(/center:\s*\[\s*([0-9.]+)(?:\s*\+\s*[0-9.]+)?\s*,\s*([0-9.]+)\s*\]/i);
  if (centerMatch) {
    const latitude = Number(centerMatch[1]);
    const longitude = Number(centerMatch[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  return null;
}

async function geocodeByQuery(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const payload = await res.json();
  const first = Array.isArray(payload) ? payload[0] : null;
  if (!first) return null;

  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

async function geocodePlace(place) {
  const name = String(place.name || "").trim();
  const address = String(place.address || "").trim();
  const city = String(place.city || "").trim();
  const normalizedAddress = normalizeAddress(address);

  const queries = [
    [normalizedAddress, city].filter(Boolean).join(", "),
    normalizedAddress,
    [address, city].filter(Boolean).join(", "),
    [name, address].filter(Boolean).join(", "),
    [name, normalizedAddress, city].filter(Boolean).join(", "),
    buildQuery(place),
    address,
  ].filter(Boolean);

  for (const query of queries) {
    const coords = await geocodeByQuery(query);
    if (coords) {
      return coords;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return null;
}

async function main() {
  await dbRun("ALTER TABLE places ADD COLUMN latitude REAL").catch(() => {});
  await dbRun("ALTER TABLE places ADD COLUMN longitude REAL").catch(() => {});
  const sourceMap = await loadSourceMap();

  const places = await dbAll(
    `SELECT id, name, city, address
     FROM places
     WHERE city = ?
       AND (latitude IS NULL OR longitude IS NULL)
     ORDER BY id`,
    ["Санкт-Петербург"]
  );

  let updated = 0;
  let skipped = 0;

  for (const place of places) {
    try {
      const manualCoords = MANUAL_COORDINATES[normalizeName(place.name)] || null;
      const sourceUrl = sourceMap.get(normalizeName(place.name));
      const coords =
        manualCoords ||
        (sourceUrl ? await fetchCoordsFromEmbed(sourceUrl).catch(() => null) : null) ||
        (await geocodePlace(place));
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
      console.error(`Geocode failed for ${place.name}:`, error.message);
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
