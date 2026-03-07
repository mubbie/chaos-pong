package game

import (
	"log"
	"math"
	"math/rand"
	"sync"
	"time"

	"github.com/mubbie/chaos-pong/backend/internal/game/powerup"
)

// ScoreCallback is called when a point is scored.
type ScoreCallback func(scorerID, scorerName string, p1Score, p2Score int)

// GameEndCallback is called when the game finishes.
type GameEndCallback func(roomID, winnerID, winnerName string, p1Score, p2Score int, stats MatchStats)

// MatchStats tracks aggregate game statistics.
type MatchStats struct {
	LongestRally     int     `json:"longestRally"`
	TotalRallies     int     `json:"totalRallies"`
	P1PowerUps       int     `json:"p1PowerUps"`
	P2PowerUps       int     `json:"p2PowerUps"`
	FastestBallSpeed float64 `json:"fastestBallSpeed"`
	P1PaddleDistance float64 `json:"p1PaddleDistance"`
	P2PaddleDistance float64 `json:"p2PaddleDistance"`
}

// GameRoom is one active game between two players.
type GameRoom struct {
	ID         string
	Player1    *Player
	Player2    *Player
	Ball       Ball
	Status     GameStatus
	Tick       uint64
	PowerUps   *powerup.Manager
	ExtraBalls []Ball

	Paused   bool   // Game is paused
	PausedBy string // Player ID who paused

	mu        sync.Mutex
	done      chan struct{}
	stopped   bool // true once Stop() is called — prevents onEnd from firing
	ended     bool // true once onEnd fires — prevents double-processing
	broadcast func(state GameState)
	onScore   ScoreCallback
	onEnd     GameEndCallback

	Stats             MatchStats
	currentRally      int
	prevP1Y           float64
	prevP2Y           float64
	paddleHitThisTick bool
	ScoreToWin        int
}

// RoomOption configures optional GameRoom settings.
type RoomOption func(*GameRoom)

// WithScoreToWin sets a custom win target (default is WinScore=11).
func WithScoreToWin(score int) RoomOption {
	return func(r *GameRoom) {
		if score > 0 {
			r.ScoreToWin = score
		}
	}
}

// NewGameRoom creates a room with two players and callbacks.
func NewGameRoom(
	id string,
	p1Info, p2Info PlayerInfo,
	broadcast func(GameState),
	onScore ScoreCallback,
	onEnd GameEndCallback,
	opts ...RoomOption,
) *GameRoom {
	room := &GameRoom{
		ID:         id,
		Status:     StatusCountdown,
		done:       make(chan struct{}),
		broadcast:  broadcast,
		onScore:    onScore,
		onEnd:      onEnd,
		PowerUps:   powerup.NewManager(),
		ScoreToWin: WinScore,
	}

	for _, opt := range opts {
		opt(room)
	}

	room.Player1 = &Player{
		ID:   p1Info.ID,
		Name: p1Info.Name,
		Side: SideLeft,
		Paddle: Paddle{
			X:      PaddleMarginX,
			Y:      ArenaHeight / 2,
			Width:  PaddleWidth,
			Height: PaddleHeight,
		},
	}

	room.Player2 = &Player{
		ID:   p2Info.ID,
		Name: p2Info.Name,
		Side: SideRight,
		Paddle: Paddle{
			X:      ArenaWidth - PaddleMarginX,
			Y:      ArenaHeight / 2,
			Width:  PaddleWidth,
			Height: PaddleHeight,
		},
	}

	room.resetBall(SideLeft)

	room.prevP1Y = room.Player1.Paddle.Y
	room.prevP2Y = room.Player2.Paddle.Y

	return room
}

// Run starts the game loop. Blocks until the game ends or is cancelled.
func (r *GameRoom) Run() {
	log.Printf("[game] room %s starting countdown", r.ID)

	// Countdown phase
	ticker := time.NewTicker(TickDuration)
	defer ticker.Stop()

	countdownTicks := 0

	for {
		select {
		case <-ticker.C:
			r.mu.Lock()

			// Skip countdown progress while paused
			if r.Paused {
				state := r.buildState()
				r.Tick++
				r.mu.Unlock()
				r.broadcast(state)
				continue
			}

			countdownTicks++

			// Broadcast countdown state (ball stationary, paddles can move)
			r.updatePaddles(float64(TickDuration) / float64(time.Second))
			state := r.buildState()
			r.Tick++
			r.mu.Unlock()

			r.broadcast(state)

			if countdownTicks >= CountdownTicks {
				goto playing
			}

		case <-r.done:
			return
		}
	}

playing:
	log.Printf("[game] room %s playing", r.ID)

	r.mu.Lock()
	r.Status = StatusPlaying
	r.mu.Unlock()

	dt := float64(TickDuration) / float64(time.Second)

	for {
		select {
		case <-ticker.C:
			r.mu.Lock()

			// Skip all physics while paused — still broadcast state so clients see "PAUSED"
			if r.Paused {
				state := r.buildState()
				r.Tick++
				r.mu.Unlock()
				r.broadcast(state)
				continue
			}

			r.paddleHitThisTick = false
			r.updatePaddles(dt)
			r.updateBall(dt)
			r.checkWallCollisions()
			r.checkShieldCollision()
			r.checkPaddleCollisions()

			// Process extra balls
			for i := range r.ExtraBalls {
				r.updateExtraBall(&r.ExtraBalls[i], dt)
				r.checkExtraBallWalls(&r.ExtraBalls[i])
				r.checkExtraBallPaddle(&r.ExtraBalls[i])
			}
			// Check extra ball scoring (reverse iterate to safely remove)
			for i := len(r.ExtraBalls) - 1; i >= 0; i-- {
				if scored, side := r.checkExtraBallScoring(&r.ExtraBalls[i]); scored {
					r.ExtraBalls = append(r.ExtraBalls[:i], r.ExtraBalls[i+1:]...)
					r.PowerUps.OnScore(r.buildEffectContext)
					r.handleScore(side)
					if r.checkWin() {
						state := r.buildState()
						r.mu.Unlock()
						r.broadcast(state)
						return
					}
				}
			}

			// Power-up tick: spawning + effect expiry
			r.PowerUps.Tick(r.Tick, r.buildEffectContext)

			// Clear extra balls if multi-ball effect has expired
			if len(r.ExtraBalls) > 0 && !r.hasMultiBallEffect() {
				r.ExtraBalls = nil
			}

			// Check power-up collection
			if r.PowerUps.CheckCollection(r.Ball.X, r.Ball.Y, r.Ball.Size) {
				collectedType := r.PowerUps.Spawned.Type
				ctx := r.buildEffectContext(r.PowerUps.LastHitterID)
				if ctx != nil {
					r.PowerUps.Collect(ctx)
					// Track power-up collection stats
					if ctx.Collector.ID == r.Player1.ID {
						r.Stats.P1PowerUps++
					} else {
						r.Stats.P2PowerUps++
					}
					// Spawn extra balls if multi-ball was collected
					if collectedType == powerup.TypeMultiBall {
						r.spawnExtraBalls()
					}
				} else {
					// No valid collector (e.g. no one has hit the ball yet).
					// Discard the power-up so it doesn't block future spawns.
					r.PowerUps.DiscardSpawned()
				}
			}

			scored, scoringSide := r.checkScoring()
			if scored {
				// Clear all power-up effects on score
				r.PowerUps.OnScore(r.buildEffectContext)
				r.handleScore(scoringSide)

				if r.checkWin() {
					state := r.buildState()
					r.mu.Unlock()
					r.broadcast(state)
					return
				}
			}

			state := r.buildState()
			r.Tick++
			r.mu.Unlock()

			r.broadcast(state)

		case <-r.done:
			return
		}
	}
}

// handleScore increments the scorer's score, fires the callback, and resets the ball.
func (r *GameRoom) handleScore(scoringSide PlayerSide) {
	// Track rally stats
	if r.currentRally > r.Stats.LongestRally {
		r.Stats.LongestRally = r.currentRally
	}
	r.Stats.TotalRallies++
	r.currentRally = 0
	r.ExtraBalls = nil

	var scorer *Player
	if scoringSide == SideLeft {
		r.Player1.Score++
		scorer = r.Player1
	} else {
		r.Player2.Score++
		scorer = r.Player2
	}

	log.Printf("[game] room %s: %s scored! (%d - %d)",
		r.ID, scorer.Name, r.Player1.Score, r.Player2.Score)

	if r.onScore != nil {
		r.onScore(scorer.ID, scorer.Name, r.Player1.Score, r.Player2.Score)
	}

	// Serve toward the player who was scored on
	r.resetBall(scoringSide.opposite())
}

// checkWin checks if a player has won.
// Standard rule: first to WinScore, but if both reach WinScore-1 (deuce),
// must win by 2 points (like table tennis).
func (r *GameRoom) checkWin() bool {
	p1 := r.Player1.Score
	p2 := r.Player2.Score

	// Neither player has reached the minimum win score
	if p1 < r.ScoreToWin && p2 < r.ScoreToWin {
		return false
	}

	// At deuce (both >= ScoreToWin-1), need 2-point lead
	diff := p1 - p2
	if diff < 0 {
		diff = -diff
	}
	if p1 >= r.ScoreToWin-1 && p2 >= r.ScoreToWin-1 && diff < 2 {
		return false
	}

	r.Status = StatusFinished

	// If Stop() was already called (e.g. tournament cancel or forfeit),
	// don't fire onEnd — the caller of Stop() handles cleanup instead.
	if r.stopped {
		return true
	}
	r.ended = true

	var winner *Player
	if p1 > p2 {
		winner = r.Player1
	} else {
		winner = r.Player2
	}

	log.Printf("[game] room %s: %s wins! (%d - %d)",
		r.ID, winner.Name, r.Player1.Score, r.Player2.Score)

	if r.onEnd != nil {
		r.onEnd(r.ID, winner.ID, winner.Name, r.Player1.Score, r.Player2.Score, r.Stats)
	}
	return true
}

// spawnExtraBalls creates 1-2 extra balls at center with random angles.
func (r *GameRoom) spawnExtraBalls() {
	count := 1 + rand.Intn(2) // 1 or 2
	for i := 0; i < count; i++ {
		angle := (rand.Float64()*120 - 60) * (math.Pi / 180) // -60 to +60 degrees
		dir := 1.0
		if rand.Intn(2) == 0 {
			dir = -1.0
		}
		ball := Ball{
			X:     ArenaWidth / 2,
			Y:     ArenaHeight / 2,
			Speed: BallSpeedInit,
			Size:  BallSize,
			VX:    dir * BallSpeedInit * math.Cos(angle),
			VY:    BallSpeedInit * math.Sin(angle),
		}
		r.ExtraBalls = append(r.ExtraBalls, ball)
	}
}

// hasMultiBallEffect checks if a multi-ball effect is currently active.
func (r *GameRoom) hasMultiBallEffect() bool {
	for _, e := range r.PowerUps.Effects {
		if e.Type == powerup.TypeMultiBall {
			return true
		}
	}
	return false
}

// buildState constructs the GameState snapshot for broadcasting.
func (r *GameRoom) buildState() GameState {
	state := GameState{
		Ball: BallState{
			X:    r.Ball.X,
			Y:    r.Ball.Y,
			VX:   r.Ball.VX,
			VY:   r.Ball.VY,
			Size: r.Ball.Size,
		},
		Player1: PlayerState{
			ID:           r.Player1.ID,
			Name:         r.Player1.Name,
			PaddleY:      r.Player1.Paddle.Y,
			PaddleHeight: r.Player1.Paddle.Height,
			Score:        r.Player1.Score,
		},
		Player2: PlayerState{
			ID:           r.Player2.ID,
			Name:         r.Player2.Name,
			PaddleY:      r.Player2.Paddle.Y,
			PaddleHeight: r.Player2.Paddle.Height,
			Score:        r.Player2.Score,
		},
		Status:        r.Status,
		Tick:          r.Tick,
		Timestamp:     time.Now().UnixMilli(),
		BallInvisible: r.Ball.Invisible,
		Paused:        r.Paused,
		PausedBy:      r.PausedBy,
		RallyCount:    r.currentRally,
		PaddleHit:     r.paddleHitThisTick,
		ScoreToWin:    r.ScoreToWin,
		Player1Effects: PlayerEffectsState{
			PaddleHeight: r.Player1.Paddle.Height,
			Frozen:       r.Player1.Frozen,
			Reversed:     r.Player1.Reversed,
			HasCannon:    r.PowerUps.PlayerHasCannonArmed(r.Player1.ID),
		},
		Player2Effects: PlayerEffectsState{
			PaddleHeight: r.Player2.Paddle.Height,
			Frozen:       r.Player2.Frozen,
			Reversed:     r.Player2.Reversed,
			HasCannon:    r.PowerUps.PlayerHasCannonArmed(r.Player2.ID),
		},
	}

	// Spawned power-up on field
	if r.PowerUps.Spawned != nil && r.PowerUps.Spawned.Active {
		state.PowerUp = &PowerUpFieldState{
			Type: int(r.PowerUps.Spawned.Type),
			X:    r.PowerUps.Spawned.X,
			Y:    r.PowerUps.Spawned.Y,
		}
	}

	// Active effects
	for _, e := range r.PowerUps.Effects {
		ticksLeft := int(e.StartTick+e.DurationTicks) - int(r.Tick)
		if ticksLeft < 0 {
			ticksLeft = 0
		}
		state.ActiveEffects = append(state.ActiveEffects, EffectState{
			Type:      int(e.Type),
			OwnerID:   e.OwnerPlayerID,
			TicksLeft: ticksLeft,
		})
	}

	// Shield
	shield := r.PowerUps.GetShieldEffect()
	if shield != nil {
		state.Shield = &ShieldState{
			Active: true,
			X:      shield.Data.ShieldX,
			Y:      shield.Data.ShieldY,
			Width:  shield.Data.ShieldWidth,
			Height: shield.Data.ShieldHeight,
			Side:   shield.Data.ShieldSide,
		}
	}

	// Extra balls
	for _, eb := range r.ExtraBalls {
		state.ExtraBalls = append(state.ExtraBalls, BallState{
			X:    eb.X,
			Y:    eb.Y,
			VX:   eb.VX,
			VY:   eb.VY,
			Size: eb.Size,
		})
	}

	return state
}

// buildEffectContext creates an EffectContext for the given ownerID.
// Used by PowerUpManager for applying/removing effects.
func (r *GameRoom) buildEffectContext(ownerID string) *powerup.EffectContext {
	var collector, opponent *Player
	if ownerID == r.Player1.ID {
		collector = r.Player1
		opponent = r.Player2
	} else if ownerID == r.Player2.ID {
		collector = r.Player2
		opponent = r.Player1
	} else {
		return nil
	}

	return &powerup.EffectContext{
		Collector: &powerup.PlayerRef{
			ID:           collector.ID,
			PaddleHeight: &collector.Paddle.Height,
			PaddleY:      &collector.Paddle.Y,
			Frozen:       &collector.Frozen,
			Reversed:     &collector.Reversed,
			Side:         int(collector.Side),
		},
		Opponent: &powerup.PlayerRef{
			ID:           opponent.ID,
			PaddleHeight: &opponent.Paddle.Height,
			PaddleY:      &opponent.Paddle.Y,
			Frozen:       &opponent.Frozen,
			Reversed:     &opponent.Reversed,
			Side:         int(opponent.Side),
		},
		Ball: &powerup.BallRef{
			VX:        &r.Ball.VX,
			VY:        &r.Ball.VY,
			Speed:     &r.Ball.Speed,
			Invisible: &r.Ball.Invisible,
		},
	}
}

// GetMatchInfo returns current match info for spectator match listing.
func (r *GameRoom) GetMatchInfo() (p1Name, p2Name string, p1Score, p2Score int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.Player1.Name, r.Player2.Name, r.Player1.Score, r.Player2.Score
}

// GetScoreToWin returns the configured win target for this room.
func (r *GameRoom) GetScoreToWin() int {
	return r.ScoreToWin
}

// SetInput sets the paddle direction for a player (called from WS goroutine).
func (r *GameRoom) SetInput(playerID string, dir PaddleDirection) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.Player1.ID == playerID {
		r.Player1.Input = dir
	} else if r.Player2.ID == playerID {
		r.Player2.Input = dir
	}
}

// TogglePause toggles the pause state. Returns true if now paused, false if resumed.
func (r *GameRoom) TogglePause(playerID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Can't pause a finished game
	if r.Status == StatusFinished {
		return false
	}

	if r.Paused {
		// Either player can unpause
		r.Paused = false
		r.PausedBy = ""
		return false
	}
	r.Paused = true
	r.PausedBy = playerID
	return true
}

// IsPaused returns whether the game is currently paused.
func (r *GameRoom) IsPaused() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.Paused
}

// Stop signals the game loop to exit and prevents onEnd from firing.
// Returns true if this call actually stopped the game, false if it was
// already stopped or had already ended naturally.
func (r *GameRoom) Stop() bool {
	r.mu.Lock()
	if r.stopped || r.ended {
		r.mu.Unlock()
		return false
	}
	r.stopped = true
	r.mu.Unlock()

	select {
	case <-r.done:
		// Already closed
		return false
	default:
		close(r.done)
		return true
	}
}

// HasPlayer checks if a given client ID is in this room.
func (r *GameRoom) HasPlayer(clientID string) bool {
	return r.Player1.ID == clientID || r.Player2.ID == clientID
}

// GetPlayerIDs returns the IDs of both players.
func (r *GameRoom) GetPlayerIDs() (string, string) {
	return r.Player1.ID, r.Player2.ID
}

// GetForfeitResult returns the winner info when a player disconnects.
// Returns alreadyFinished=true if the game naturally ended just before the forfeit.
func (r *GameRoom) GetForfeitResult(disconnectedID string) (winnerID, winnerName string, p1Score, p2Score int, stats MatchStats, alreadyFinished bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.Status == StatusFinished || r.ended {
		return "", "", 0, 0, r.Stats, true
	}
	r.Status = StatusFinished
	r.stopped = true // Prevent onEnd from also firing

	p1Score = r.Player1.Score
	p2Score = r.Player2.Score
	stats = r.Stats

	if r.Player1.ID == disconnectedID {
		return r.Player2.ID, r.Player2.Name, p1Score, p2Score, stats, false
	}
	return r.Player1.ID, r.Player1.Name, p1Score, p2Score, stats, false
}

// opposite returns the other side.
func (s PlayerSide) opposite() PlayerSide {
	if s == SideLeft {
		return SideRight
	}
	return SideLeft
}
