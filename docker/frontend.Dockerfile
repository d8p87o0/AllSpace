FROM node:24-bookworm-slim AS build

WORKDIR /app

ARG VITE_API_BASE=/api
ARG SITEMAP_API_BASE=http://backend:3001

ENV VITE_API_BASE=$VITE_API_BASE
ENV SITEMAP_API_BASE=$SITEMAP_API_BASE

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
