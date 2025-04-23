# 🕹️ Chaos Pong – Implementation Plan'

Goal is to learn by building. Each phase introduces new features while helping me learn essential backend, frontend, and multiplayer game development skills.

---

## 📌 Guiding Principles

- **Learn by doing**: Build core features step by step.
- **MVP-first mindset**: Start small, grow features incrementally.
- **Ship early, ship often**: Get feedback even with rough edges.
- **Documentation-driven**: Keep track of what you learn and break.

---

## 🗺️ Project Milestones

---

### ✅ Milestone 0: Project Setup

> Get the basic repo structure and dev setup working.

#### 📝 Tasks

- [ ] Create GitHub repo
- [ ] Initialize Go `backend/`
- [ ] Create `client/` directory with barebones HTML + Phaser engine
- [ ] Setup basic file structure
- [ ] Add hot reload support (Vite for frontend, air or reflex for Go)
- [ ] Create a makefile with common commands, build, and quick dev setup
- [ ] Push to Github and test local dev setup

#### 📚 Learn
- [ ] Complete introduction to [Go courses](https://www.boot.dev/courses/learn-golang)  
- [ ] Complete introduction to [JS/TS courses](https://www.boot.dev/courses/learn-javascript)
- [ ] Learn basics of [Phaser game engine](https://phaser.io/learn), and game scene setup
- [ ] Learn how vite, air, and reflex work
- [ ] Learn how Websockets work with Go (starting with Gorilla WebSocket)

---

### 🧪 Milestone 1: Core Pong Game (Local Only)

> Goal: Make a simple Pong game in Phaser, 1v1 on one screen.

#### 📝 Tasks

- [ ] Setup Phaser canvas and load paddles, ball
- [ ] Implement physics + collision detection
- [ ] Add simple scoring system (race to 11)
- [ ] Display score + restart game after win

#### 📚 Learn

- [ ] Phaser’s Arcade physics
- [ ] Game loop anatomy: update, render
- [ ] Handling game state in JS

---

### 🧪 Milestone 2: WebSocket Multiplayer

> Goal: Make it playable with 2 players via WebSocket and Go backend.

#### 📝 Tasks

##### Backend

- [ ] Add WebSocket endpoint using Gorilla WebSocket
- [ ] Create basic player struct, game session manager
- [ ] Use Go channels for game loop ticks

##### Frontend

- [ ] Connect to backend via WebSocket
- [ ] Send player inputs (up/down)
- [ ] Receive game state updates (ball, paddles, score)
- [ ] Sync rendering to state

#### 📚 Learn

- [ ] JSON serialization for game state
- [ ] Go concurrency basics: goroutines + channels
- [ ] Handling lag and desyncs (just detect for now)

---

### 🧩 Milestone 3: Lobby & Matchmaking

> Goal: Let players join the game with a name and get matched.

#### 📝 Tasks

- [ ] Create a Redis-backed player queue
- [ ] Create `/join` page with name form
- [ ] Match players into games using Redis
- [ ] Launch a game session per matched pair

#### 📚 Learn

- [ ] Redis basics
- [ ] Redis with Go using `go-redis`
- [ ] Basic HTMX for dynamic lobby
- [ ] Go HTTP server basics
- [ ] Game room management (in memory or Redis)

---

### Milestone 4: Game Logs & Leaderboard

> Goal: Store match data and rank players.

#### 📝 Tasks

- [ ] Add PostgreSQL schema:
  - [ ] players(id, name, wins, elo)
  - [ ] game_logs(id, player_a, player_b, score_a, score_b, winner)
- [ ] Store match results after each game
- [ ] Compute ELO changes
- [ ] Show leaderboard (HTMX)

#### 📚 Learn

- [ ] SQL basics (joins, upserts, indexes)
- [ ] PostgreSQL basics
- [ ] Go database/ORM (Gorm)
- [ ] ELO rating system
- [ ] Using pgx in Go

---

### Milestone 5: Chat, Emoji Taunts, SFX

> Goal: Goal: Add the fun and chaos juice.

#### 📝 Tasks

- [ ] In-game WebSocket chat
- [ ] Emoji reactions from players
- [ ] Sound FX (hit, score, win)
- [ ] Optional: Music playlist synced to game space (easy if spotify account login can be done easily))

#### 📚 Learn

- [ ] WebSocket pub/sub for chat
- [ ] HTML5 Audio API
- [ ] Rate-limiting emoji spam
- [ ] Spotify API for music

---

### 🌀 Milestone 6: Leaderboard & Match History

> Goal: Break the game in fun ways.

#### 📝 Tasks

- [ ] Add power-up system (random spawns, effects)
- [ ] Power-up types:
  - [ ] Speed boost
  - [ ] 2nd ball
  - [ ] Paddle size change
  - [ ] Freeze opponent
- [ ] Commentary messages based on in-game events

#### 📚 Learn

- [ ] State machines for power-up timers
- [ ] Effect stack design
- [ ] Commentary engine (simple if-else for now)

---

### 🏆 Milestone 7: Tournament Mode & Spectators

> Goal: Handle more players and passive viewers.

#### 📝 Tasks

- [ ] Tournament queue (4 or 8-player brackets)
- [ ] Redis-persisted bracket state
- [ ] Spectator view via WebSocket
- [ ] Match summary with stats

#### 📚 Learn

- [ ] Bracket generation
- [ ] Bracket generation
- [ ] Spectator view design
- [ ] Spectator multiplexing

---

### 🚀 Milestone 8: Deploy to Fly.io

> Goal: Goal: Make it live for friends to try!

#### 📝 Tasks

- [ ] Write Dockerfile with multi-stage Go + Vite build
- [ ] Set up fly.toml config
- [ ] Deploy backend + frontend to Fly.io
- [ ] Setup .env config for Redis + Postgres URLs

#### 📚 Learn

- [ ] Docker multi-stage builds
- [ ] Fly.io deploy flows
- [ ] CI/CD with GitHub Actions

---

## 🧾 Learning & Tracking Template

```md
## Milestone 2 - Multiplayer WebSocket

### What I learned
- How to create WebSocket endpoints with Gorilla
- Using Go channels to manage player state
- Phaser syncing with server tick loop

### What broke 😅
- Ball teleporting on lag spikes
- Players desyncing after browser tab change

### Questions I still have
- How to handle network latency better?
- Should I interpolate or snap updates?

### Next step
- Add player queue + matchmaking
```