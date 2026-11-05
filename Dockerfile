# One image runs both the web server and the background worker. Choose which with the command.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# SITE_MODE=production removes the concept wording and noindex. Set it only after owner approval.
ARG SITE_MODE=preview
ARG SITE_URL=
RUN SITE_MODE=$SITE_MODE SITE_URL=$SITE_URL npx vite build \
  && SITE_MODE=$SITE_MODE SITE_URL=$SITE_URL node --disable-warning=ExperimentalWarning scripts/postbuild.mjs \
  && node scripts/build-server.mjs

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY package.json ./
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
