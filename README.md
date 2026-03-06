# Chaos Pong

Real-time multiplayer Pong with neon visuals, procedural audio, and chaotic effects. Built with a Go backend (WebSocket game server) and a Phaser 3 frontend.

## Prerequisites

- **Go** 1.21+ ([install](https://go.dev/dl/))
- **Node.js** 18+ and npm ([install](https://nodejs.org/))
- GNU Make (optional, for `make` commands)

## Quick Start

### 1. Install client dependencies

```bash
cd client
npm install
```

### 2. Start the backend (terminal 1)

```bash
cd backend
go run main.go
```

The game server starts on `http://localhost:8080` with a WebSocket endpoint at `/ws`.

### 3. Start the frontend dev server (terminal 2)

```bash
cd client
npx vite
```

Opens on `http://localhost:5173`. The Vite dev server proxies WebSocket connections to the Go backend.

### 4. Play

Open **two browser tabs** to `http://localhost:5173`. Enter a name in each and click **Join Queue**. Once matched, the game starts automatically.

**Controls:** Arrow keys (Up/Down) or W/S to move your paddle.

## Using Make

```bash
make client-install   # npm install in client/
make run              # go run the backend
make client-dev       # start Vite dev server
make build            # compile Go binary to bin/
make clean            # remove bin/ and client/dist/
```

## Project Structure

```
chaos-pong/
  backend/             # Go game server
    main.go            # Entry point (HTTP + WebSocket)
    internal/
      game/            # Game loop, physics, scoring (60 tick/sec)
      session/         # Player session management, matchmaking queue
      server/          # HTTP routes, stats endpoint
      ws/              # WebSocket hub, client connections
  client/              # Phaser 3 frontend (TypeScript + Vite)
    src/
      scenes/          # GameScene (gameplay), GameOverScene
      audio/           # SynthAudio (procedural Web Audio API sounds)
      network/         # WebSocket client (SocketManager)
      types/           # Message type definitions
  Makefile
```

## Architecture

- **Server-authoritative**: The Go backend owns all game state. Clients only send paddle direction (-1, 0, 1).
- **60 tick/sec game loop**: Server runs physics, collision detection, and scoring at 60 FPS, broadcasting state via WebSocket.
- **WebSocket protocol**: JSON envelope `{type, payload}` for all messages.
- **Matchmaking**: FIFO queue pairs players automatically.
- **Deuce rule**: First to 11 points, but must win by 2 after 10-10 (like table tennis).

## Game Features

- Neon color palette (cyan vs magenta paddles, purple accents)
- Round ball with speed-based color shift and glow trail
- Procedural audio (paddle hits, wall bounces, goals, countdown beeps)
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
