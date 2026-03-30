# syntax=docker/dockerfile:1

# === STAGE 1: build ===
# Node 20 LTS (Alpine): supporta --dns-result-order e dns.setDefaultResultOrder (IPv4 prima di IPv6).
FROM node:20-alpine AS build

WORKDIR /app

# Copia solo ciò che serve per installare le dipendenze
COPY package.json package-lock.json ./

RUN npm ci

# Copia il codice sorgente e config TypeScript
COPY tsconfig.json ./
COPY src ./src

# Compila TypeScript in dist/
RUN npm run build

# === STAGE 2: runtime ===
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Copia solo i file necessari
COPY package.json package-lock.json ./

# Installa solo le dipendenze di produzione
RUN npm ci --omit=dev

# Copia l'output compilato
COPY --from=build /app/dist ./dist

# Porta esposta nel container (allineata al compose)
EXPOSE 4000

# Allineato a NODE_OPTIONS nel compose: ordine DNS ipv4first anche se le env non vengono ereditate.
CMD ["node", "--dns-result-order=ipv4first", "dist/index.js"]
