package powerup

// PowerUpType identifies which power-up this is.
type PowerUpType int

const (
	TypeBigPaddle       PowerUpType = 1
	TypeShrink          PowerUpType = 2
	TypeSpeedBoost      PowerUpType = 3
	TypeCannonShot      PowerUpType = 4
	TypeFreeze          PowerUpType = 5
	TypeReverseControls PowerUpType = 6
	TypeGhostBall       PowerUpType = 7
	TypeShield          PowerUpType = 8
	TypeMultiBall       PowerUpType = 9
)

// TargetKind specifies who the effect applies to.
type TargetKind int

const (
	TargetSelf     TargetKind = 0
	TargetOpponent TargetKind = 1
	TargetBall     TargetKind = 2
)

// SpawnedPowerUp represents a power-up sitting on the field, waiting to be collected.
type SpawnedPowerUp struct {
	Type   PowerUpType
	X, Y   float64 // Center position on the arena
	Size   float64 // Collision radius
	Active bool
}

// ActiveEffect represents a power-up effect currently in play.
type ActiveEffect struct {
	Type          PowerUpType
	OwnerPlayerID string     // Who collected it
	TargetKind    TargetKind // Self, Opponent, or Ball
	StartTick     uint64
	DurationTicks uint64 // 0 = instant (already applied)
	Data          EffectData
}

// EffectData holds mutable state for different effect types.
type EffectData struct {
	// BigPaddle / Shrink — original height to restore
	OriginalPaddleHeight float64

	// CannonShot
	CannonArmed bool

	// Shield
	ShieldX      float64
	ShieldY      float64
	ShieldWidth  float64
	ShieldHeight float64
	ShieldSide   int // 0=left, 1=right

	// SpeedBoost
	SpeedAdded float64
}

// PowerUpEffect is the interface each power-up type implements.
type PowerUpEffect interface {
	Type() PowerUpType
	Target() TargetKind
	Duration() uint64         // Duration in ticks; 0 for instant effects
	Apply(ctx *EffectContext) // Called once on collection
	Remove(ctx *EffectContext) // Called on expiry (no-op for instant)
	Name() string              // Human-readable name
}

// EffectContext gives the effect access to the game state it needs to modify.
type EffectContext struct {
	Collector    *PlayerRef
	Opponent     *PlayerRef
	Ball         *BallRef
	ActiveEffect *ActiveEffect
}

// PlayerRef is a pointer wrapper so effects can modify paddle properties.
type PlayerRef struct {
	ID           string
	PaddleHeight *float64
	PaddleY      *float64
	Frozen       *bool
	Reversed     *bool
	Side         int // 0=left, 1=right
}

// BallRef lets effects modify ball state.
type BallRef struct {
	VX        *float64
	VY        *float64
	Speed     *float64
	Invisible *bool
}
