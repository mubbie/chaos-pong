# ============================================================
# Chaos Pong — Multi-stage production build
# ============================================================
# Produces a ~30MB image with:
#   /app/chaos-pong   (Go binary)
#   /app/client/dist/ (Vite-built frontend assets)
#
# Build:  docker build -t chaos-pong .
# Run:    docker run -p 8080:8080 chaos-pong
# Deploy: Push to Render/Railway/Fly and set PORT via env.
# ============================================================

# --- Stage 1: Build frontend ---
FROM node:22-alpine AS frontend

WORKDIR /build/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci --prefer-offline
COPY client/ ./
RUN npm run build

# --- Stage 2: Build backend ---
FROM golang:1.25-alpine AS backend

WORKDIR /build/backend
COPY backend/go.mod backend/go.sum* ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /chaos-pong main.go

# --- Stage 3: Production image ---
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy compiled binary
COPY --from=backend /chaos-pong ./chaos-pong

# Copy built frontend assets
COPY --from=frontend /build/client/dist ./client/dist

# Default env — override at deploy time
ENV ENV=production \
    PORT=8080 \
    STATIC_DIR=./client/dist \
    ALLOWED_ORIGINS=*

EXPOSE 8080

CMD ["./chaos-pong"]
