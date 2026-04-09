FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY data ./data
COPY tsconfig.json ./tsconfig.json
COPY vite.config.ts ./vite.config.ts
COPY index.html ./index.html
COPY .env.example ./.env.example

EXPOSE 8787

CMD ["npm", "run", "start"]
