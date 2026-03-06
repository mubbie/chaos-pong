package game

import (
	"log"
	"sync"
	"time"
)

// ScoreCallback is called when a point is scored.
type ScoreCallback func(scorerID, scorerName string, p1Score, p2Score int)

// GameEndCallback is called when the game finishes.
type GameEndCallback func(roomID, winnerID, winnerName string, p1Score, p2Score int)

// GameRoom is one active game between two players.
type GameRoom struct {
	ID      string
	Player1 *Player
	Player2 *Player
	Ball    Ball
	Status  GameStatus
	Tick    uint64

	mu        sync.Mutex
	done      chan struct{}
	broadcast func(state GameState)
	onScore   ScoreCallback
	onEnd     GameEndCallback
}

// NewGameRoom creates a room with two players and callbacks.
func NewGameRoom(
	id string,
	p1Info, p2Info PlayerInfo,
	broadcast func(GameState),
	onScore ScoreCallback,
	onEnd GameEndCallback,
) *GameRoom {
	room := &GameRoom{
		ID:        id,
		Status:    StatusCountdown,
		done:      make(chan struct{}),
		broadcast: broadcast,
		onScore:   onScore,
		onEnd:     onEnd,
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

			r.updatePaddles(dt)
			r.updateBall(dt)
			r.checkWallCollisions()
			r.checkPaddleCollisions()

			scored, scoringSide := r.checkScoring()
			if scored {
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
	if p1 < WinScore && p2 < WinScore {
		return false
	}

	// At deuce (both >= WinScore-1), need 2-point lead
	diff := p1 - p2
	if diff < 0 {
		diff = -diff
	}
	if p1 >= WinScore-1 && p2 >= WinScore-1 && diff < 2 {
		return false
	}

	r.Status = StatusFinished

	var winner *Player
	if p1 > p2 {
		winner = r.Player1
	} else {
		winner = r.Player2
	}

	log.Printf("[game] room %s: %s wins! (%d - %d)",
		r.ID, winner.Name, r.Player1.Score, r.Player2.Score)

	if r.onEnd != nil {
		r.onEnd(r.ID, winner.ID, winner.Name, r.Player1.Score, r.Player2.Score)
	}
	return true
}

// buildState constructs the GameState snapshot for broadcasting.
func (r *GameRoom) buildState() GameState {
	return GameState{
		Ball: BallState{
			X:    r.Ball.X,
			Y:    r.Ball.Y,
			VX:   r.Ball.VX,
			VY:   r.Ball.VY,
			Size: r.Ball.Size,
		},
		Player1: PlayerState{
			ID:      r.Player1.ID,
			Name:    r.Player1.Name,
			PaddleY: r.Player1.Paddle.Y,
			Score:   r.Player1.Score,
		},
		Player2: PlayerState{
			ID:      r.Player2.ID,
			Name:    r.Player2.Name,
			PaddleY: r.Player2.Paddle.Y,
			Score:   r.Player2.Score,
		},
		Status:    r.Status,
		Tick:      r.Tick,
		Timestamp: time.Now().UnixMilli(),
	}
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

// Stop signals the game loop to exit.
func (r *GameRoom) Stop() {
	select {
	case <-r.done:
		// Already closed
	default:
		close(r.done)
	}
}

// HasPlayer checks if a given client ID is in this room.
func (r *GameRoom) HasPlayer(clientID string) bool {
	return r.Player1.ID == clientID || r.Player2.ID == clientID
}

// GetForfeitResult returns the winner info when a player disconnects.
func (r *GameRoom) GetForfeitResult(disconnectedID string) (winnerID, winnerName string, p1Score, p2Score int) {
	r.mu.Lock()
	defer r.mu.Unlock()

	p1Score = r.Player1.Score
	p2Score = r.Player2.Score

	if r.Player1.ID == disconnectedID {
		return r.Player2.ID, r.Player2.Name, p1Score, p2Score
	}
	return r.Player1.ID, r.Player1.Name, p1Score, p2Score
}

// opposite returns the other side.
func (s PlayerSide) opposite() PlayerSide {
	if s == SideLeft {
		return SideRight
	}
	return SideLeft
}
