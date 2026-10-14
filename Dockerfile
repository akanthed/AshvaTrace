# Multi-stage build: frontend (Vite/React) + backend (Express/TS), single Cloud Run image.

# --- Stage 1: build the frontend ---
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: build the backend ---
FROM node:20-alpine AS backend-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# --- Stage 3: runtime ---
FROM node:20-alpine
WORKDIR /app

COPY server/package*.json ./
RUN npm install --only=production

COPY --from=backend-build /app/server/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 8080
ENV PORT=8080

CMD ["node", "dist/index.js"]
