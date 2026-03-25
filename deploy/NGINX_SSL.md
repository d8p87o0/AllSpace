# Nginx + Let's Encrypt for `staging.allspace.com.ru`

Before starting:

- DNS `A` record for `staging.allspace.com.ru` must point to this server
- Ports `80` and `443` must be open
- stop the Caddy-based staging stack first, otherwise ports `80/443` will conflict

## 1. Start bootstrap HTTP stack

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.nginx-bootstrap.yml up --build -d
```

## 2. Issue certificate

Replace the email below with your real address.

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx-bootstrap.yml run --rm certbot certonly --webroot -w /var/www/certbot -d staging.allspace.com.ru -d www.staging.allspace.com.ru --email you@example.com --agree-tos --no-eff-email
```

Certificates will be stored under:

```bash
./certbot/conf/live/staging.allspace.com.ru/
```

## 3. Switch to HTTPS nginx config

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.nginx-staging.yml up --build -d
```

## 4. Verify

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx-staging.yml ps
docker compose -f docker-compose.yml -f docker-compose.nginx-staging.yml logs --tail=200 nginx
docker compose -f docker-compose.yml -f docker-compose.nginx-staging.yml logs --tail=200 backend
```

## 5. Renew certificates

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx-staging.yml run --rm certbot renew
docker compose -f docker-compose.yml -f docker-compose.nginx-staging.yml restart nginx
```
