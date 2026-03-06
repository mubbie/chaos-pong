# Chaos Pong

Real-time multiplayer Pong with neon visuals, procedural audio, and chaotic effects. Built with a Go backend (WebSocket game server) and a Phaser 3 frontend.

## Play Online

**[chaos-pong.onrender.com](https://chaos-pong.onrender.com)**

Open in two browser tabs (or send the link to a friend) and hit **Join Queue**.

## Local Development

### Prerequisites

- **Go** 1.25+ ([install](https://go.dev/dl/))
- **Node.js** 22+ and npm ([install](https://nodejs.org/))

### Setup

```bash
# Install frontend dependencies
cd client && npm install && cd ..

# Terminal 1 — start the backend
cd backend && go run main.go

# Terminal 2 — start the frontend dev server
cd client && npx vite
```

Open **two browser tabs** to `http://localhost:5173`, enter a name in each, and click **Join Queue**.

The Vite dev server proxies `/ws` and `/api` requests to the Go backend on `:8080`.

### Controls

| Action    | Keys               |
| --------- | ------------------ |
| Move up   | `W` or `Arrow Up`  |
| Move down | `S` or `Arrow Down`|

## Game Modes

### Quickplay

Join the matchmaking queue and get paired with the next available player. First to 11 points wins (must win by 2 after deuce).

### Private Lobby

Create a private room with an invite code. Share the code with a friend to play directly without the queue.

### Tournament (Best-of-N)

Host a 4-player single-elimination tournament:
1. Host creates a tournament lobby and shares the invite code
2. Once 4 players join, the host starts the bracket
3. Two semi-finals are played, then the winners face off in the final
4. Configurable best-of-1, best-of-3, or best-of-5 series per round

## Docker

```bash
# Build
docker build -t chaos-pong .

# Run
docker run -p 8080:8080 chaos-pong

# Visit http://localhost:8080
```

## Deployment

The app is deployed on [Render](https://render.com) as a Docker web service. Render auto-deploys on every push to `main`.

### Environment Variables

| Variable          | Default         | Description                                          |
| ----------------- | --------------- | ---------------------------------------------------- |
| `PORT`            | `8080`          | Server listen port (set automatically by most hosts) |
| `ENV`             | `development`   | `development` or `production`                        |
| `ALLOWED_ORIGINS` | `*`             | Comma-separated WebSocket origin allowlist            |
| `STATIC_DIR`      | auto-detect     | Path to built frontend assets                        |

For production, set `ALLOWED_ORIGINS` to your domain (e.g. `https://chaos-pong.onrender.com`).

## Project Structure

```
chaos-pong/
  backend/                  # Go game server
    main.go                 # Entry point, graceful shutdown
    internal/
      config/               # Environment-based configuration
      game/                 # Game loop, physics, scoring (60 tick/s)
      matchmaking/          # FIFO matchmaking queue
      session/              # Session manager, message routing
      tournament/           # Tournament state machine, bracket logic
      server/               # HTTP routes, static file serving
      ws/                   # WebSocket hub, client connections, rate limiting
  client/                   # Phaser 3 frontend (TypeScript + Vite)
    src/
      scenes/               # GameScene, GameOverScene
      audio/                # Procedural Web Audio API sounds
      network/              # WebSocket client (SocketManager)
      types/                # Message type definitions
  Dockerfile                # Multi-stage production build
  Makefile                  # Dev shortcuts
```

## Architecture

- **Server-authoritative** — the Go backend owns all game state. Clients only send paddle direction (`-1`, `0`, `1`).
- **60 tick/s game loop** — server runs physics, collision detection, and scoring at 60 FPS, broadcasting state via WebSocket.
- **WebSocket protocol** — JSON envelope `{type, payload}` for all messages.
- **Token-bucket rate limiting** — WebSocket messages are rate-limited (120 burst, 100/s sustained).
- **Graceful shutdown** — SIGINT/SIGTERM triggers a 10-second drain before exit.

## Visual Effects

- Neon color palette (cyan vs magenta paddles, purple accents)
- Ball speed-based color shift and glow trail
- Hit stop + pitch ramping on paddle impacts
- Screen shake, camera zoom, and goal slow-mo
- Ball squash & stretch at high speed
- Paddle squash on impact
- Lightning sparks between ball and nearby paddle
- Streak flames on consecutive scores
- Rally counter with escalating visuals
- Match point / deuce / advantage alerts
- Commentary pop-ups and speed tier announcements
- Near-miss edge sparks
- Background intensity shifts with game momentum

## Make Commands

```bash
make client-install   # npm install in client/
make run              # start the backend
make client-dev       # start Vite dev server
make client-build     # production build of frontend
make build            # compile Go binary to bin/
make clean            # remove bin/ and client/dist/
```
