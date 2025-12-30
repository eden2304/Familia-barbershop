# ---------- Build stage ----------
FROM node:20-alpine AS build

WORKDIR /app

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

# Install a tiny static server
RUN npm i -g serve

# Copy build output only
COPY --from=build /app/dist ./dist

# Railway provides PORT; default just in case
ENV PORT=8080

# Serve the static site on the correct port
CMD ["sh", "-lc", "serve -s dist -l ${PORT}"]
