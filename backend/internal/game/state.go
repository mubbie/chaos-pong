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
	StatusWaiting  GameStatus = 0
	StatusCountdown GameStatus = 1
	StatusPlaying  GameStatus = 2
	StatusFinished GameStatus = 3
)

// Player represents one participant in a game room.
type Player struct {
	ID    string
	Name  string
	Side  PlayerSide
	Paddle Paddle
	Score int
	Input PaddleDirection
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
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	VX    float64 `json:"vx"`
	VY    float64 `json:"vy"`
	Size  float64 `json:"size"`
	Speed float64 `json:"-"` // current scalar speed (internal)
}

// GameState is the snapshot sent to clients each tick.
type GameState struct {
	Ball    BallState   `json:"ball"`
	Player1 PlayerState `json:"player1"`
	Player2 PlayerState `json:"player2"`
	Status  GameStatus  `json:"status"`
	Tick    uint64      `json:"tick"`
	Timestamp int64     `json:"timestamp"`
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
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	PaddleY float64 `json:"paddleY"`
	Score   int     `json:"score"`
}

// PlayerInfo is the minimal info needed to create a Player in a room.
type PlayerInfo struct {
	ID   string
	Name string
}
