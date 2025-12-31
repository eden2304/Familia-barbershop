# ---------- Build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Accept build-time variables from Railway
ARG VITE_API_BASE
ARG VITE_API_URL

# Expose them to Vite during build
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_API_URL=${VITE_API_URL}

# Install deps first (better caching)
COPY package*.json ./
RUN npm ci

# Copy the rest of the frontend
COPY . .

# Build Vite -> dist/
RUN npm run build


# ---------- Runtime stage ----------
FROM node:20-alpine AS runtime
WORKDIR /app

RUN npm i -g serve

COPY --from=build /app/dist ./dist

ENV PORT=8080
CMD ["sh", "-lc", "serve -s dist -l ${PORT}"]
