package game

// PaddleDirection represents the player's current input.
type PaddleDirection int

const (
	PaddleDirNone PaddleDirection = 0
	PaddleDirUp   PaddleDirection = -1
	PaddleDirDown PaddleDirection = 1
)

// PlayerSide indicates which side of the arena a player is on.
type PlayerSide int

const (
	SideLeft  PlayerSide = 0
	SideRight PlayerSide = 1
)

// GameStatus represents the current phase of a game.
type GameStatus int

const (
	StatusWaiting   GameStatus = 0
	StatusCountdown GameStatus = 1
	StatusPlaying   GameStatus = 2
	StatusFinished  GameStatus = 3
)

// Player represents one participant in a game room.
type Player struct {
	ID       string
	Name     string
	Side     PlayerSide
	Paddle   Paddle
	Score    int
	Input    PaddleDirection
	Frozen   bool // Cannot move when true (Freeze power-up)
	Reversed bool // Controls are swapped when true (Reverse Controls power-up)
}

// Paddle represents a paddle's current state.
type Paddle struct {
	X      float64
	Y      float64 // center Y
	Width  float64
	Height float64
}

// Ball represents the ball's current state.
type Ball struct {
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	VX        float64 `json:"vx"`
	VY        float64 `json:"vy"`
	Size      float64 `json:"size"`
	Speed     float64 `json:"-"` // current scalar speed (internal)
	Invisible bool    `json:"-"` // ball is invisible to clients (Ghost Ball power-up)
}

// GameState is the snapshot sent to clients each tick.
type GameState struct {
	Ball           BallState           `json:"ball"`
	Player1        PlayerState         `json:"player1"`
	Player2        PlayerState         `json:"player2"`
	Status         GameStatus          `json:"status"`
	Tick           uint64              `json:"tick"`
	Timestamp      int64               `json:"timestamp"`
	PowerUp        *PowerUpFieldState  `json:"powerUp,omitempty"`
	ActiveEffects  []EffectState       `json:"activeEffects,omitempty"`
	Player1Effects PlayerEffectsState  `json:"player1Effects"`
	Player2Effects PlayerEffectsState  `json:"player2Effects"`
	BallInvisible  bool                `json:"ballInvisible"`
	Shield         *ShieldState        `json:"shield,omitempty"`
	ExtraBalls     []BallState         `json:"extraBalls,omitempty"`
	Paused         bool                `json:"paused,omitempty"`
	PausedBy       string              `json:"pausedBy,omitempty"`
	RallyCount     int                 `json:"rallyCount"`
	PaddleHit      bool                `json:"paddleHit,omitempty"`
	ScoreToWin     int                 `json:"scoreToWin"`
}

// BallState is the serializable ball state.
type BallState struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	VX   float64 `json:"vx"`
	VY   float64 `json:"vy"`
	Size float64 `json:"size"`
}

// PlayerState is the subset of Player sent to clients.
type PlayerState struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	PaddleY      float64 `json:"paddleY"`
	PaddleHeight float64 `json:"paddleHeight"`
	Score        int     `json:"score"`
}

// PlayerInfo is the minimal info needed to create a Player in a room.
type PlayerInfo struct {
	ID   string
	Name string
}

// ---- Power-up serializable state types ----

// PowerUpFieldState represents an uncollected power-up on the field.
type PowerUpFieldState struct {
	Type int     `json:"type"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

// EffectState represents an active power-up effect.
type EffectState struct {
	Type      int    `json:"type"`
	OwnerID   string `json:"ownerId"`
	TicksLeft int    `json:"ticksLeft"`
}

// PlayerEffectsState tells the client what effects are active on a player.
type PlayerEffectsState struct {
	PaddleHeight float64 `json:"paddleHeight"`
	Frozen       bool    `json:"frozen"`
	Reversed     bool    `json:"reversed"`
	HasCannon    bool    `json:"hasCannon"`
}

// ShieldState represents an active shield wall.
type ShieldState struct {
	Active bool    `json:"active"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Side   int     `json:"side"` // 0=left, 1=right
}
