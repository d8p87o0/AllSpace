import { Helmet } from "react-helmet-async";

export const SEO_SITE_URL = "https://allspace.ru";

const DEFAULT_TITLE =
  "ALLSPACE — места для работы: кафе, коворкинги и библиотеки";

const DEFAULT_DESCRIPTION =
  "Найди идеальное место для работы: проверенные кафе, коворкинги и библиотеки с Wi-Fi, розетками, рейтингами и отзывами.";

const DEFAULT_IMAGE = `${SEO_SITE_URL}/og-default.jpg`;

export default function SEO({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  image = DEFAULT_IMAGE,
  url = SEO_SITE_URL,
  type = "website",
  noindex = false,
  jsonLd = null,
}) {
  return (
    <Helmet prioritizeSeoTags>
      <html lang="ru" />
      <title>{title}</title>
      <meta name="description" content={description} />

      {noindex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta
          name="robots"
          content="index, follow, max-image-preview:large"
        />
      )}

      <link rel="canonical" href={url} />

      <meta property="og:locale" content="ru_RU" />
      <meta property="og:site_name" content="ALLSPACE" />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {jsonLd ? (
        <script type="application/ld+json">
          {JSON.stringify(jsonLd)}
        </script>
      ) : null}
    </Helmet>
  );
}