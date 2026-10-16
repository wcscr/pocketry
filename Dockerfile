# Multi-platform digests pin the build tools and static runtime independently.
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client ./client
COPY shared ./shared
COPY samples/pocketry-sample-library.json ./samples/pocketry-sample-library.json
COPY vite.config.ts tsconfig.json tailwind.config.ts postcss.config.js LICENSE NOTICE ./
RUN ./node_modules/.bin/vite build

FROM nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
LABEL org.opencontainers.image.title="Pocketry" \
      org.opencontainers.image.source="https://github.com/wcscr/pocketry" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY deploy/nginx.conf /etc/nginx/nginx.conf
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist/public /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/index.html || exit 1
# Skip the upstream configuration-mutating entrypoint; our config is read-only.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
