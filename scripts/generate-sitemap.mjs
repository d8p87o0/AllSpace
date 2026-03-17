import fs from "fs/promises";

const SITE_URL = "https://allspace.ru";
const API_BASE = process.env.SITEMAP_API_BASE || "https://allspace.ru";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.json();
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function main() {
  const staticUrls = [
    { url: `${SITE_URL}/` },
    { url: `${SITE_URL}/articles` },
  ];

  let places = [];
  let articles = [];

  try {
    const placesData = await fetchJson(`${API_BASE}/api/places`);
    places = Array.isArray(placesData?.places) ? placesData.places : [];
  } catch (e) {
    console.error("Places sitemap fetch error:", e.message);
  }

  try {
    const articlesData = await fetchJson(`${API_BASE}/api/articles`);
    articles = Array.isArray(articlesData?.articles) ? articlesData.articles : [];
  } catch (e) {
    console.error("Articles sitemap fetch error:", e.message);
  }

  const urls = [
    ...staticUrls,
    ...places.map((p) => ({
      url: `${SITE_URL}/place/${p.id}`,
      lastmod: p.updatedAt || p.createdAt || undefined,
    })),
    ...articles.map((a) => ({
      url: `${SITE_URL}/article/${a.id}`,
      lastmod: a.updatedAt || a.publishedAt || a.createdAt || undefined,
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (item) => `  <url>
    <loc>${escapeXml(item.url)}</loc>
    ${item.lastmod ? `<lastmod>${escapeXml(new Date(item.lastmod).toISOString())}</lastmod>` : ""}
  </url>`
  )
  .join("\n")}
</urlset>`;

  await fs.writeFile("./public/sitemap.xml", xml, "utf8");
  console.log("sitemap.xml generated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});