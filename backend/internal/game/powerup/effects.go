package powerup

import "math"

// ---- Constants for effect tuning ----

const (
	BigPaddleMultiplier    = 1.5
	ShrinkMultiplier       = 0.5
	SpeedBoostAmount       = 150.0
	BallSpeedMax           = 600.0 // mirrors game constant
	BigPaddleDuration      = 420   // 7 seconds
	ShrinkDuration         = 420   // 7 seconds
	CannonShotWindow       = 600   // 10 second window
	FreezeDuration         = 90    // 1.5 seconds
	ReverseControlsDuration = 360  // 6 seconds
	GhostBallDuration      = 240   // 4 seconds
	ShieldDuration         = 480   // 8 seconds
	ShieldWidth            = 10.0
	ShieldHeight           = 130.0
	MultiBallDuration      = 360   // 6 seconds
	ShieldOffsetFromGoal   = 50.0
	ArenaWidth             = 800.0 // mirrors game constant
	ArenaHeight            = 600.0
	PaddleMarginX          = 30.0
)

// ==================== BigPaddle ====================

type BigPaddleEffect struct{}

func (e *BigPaddleEffect) Type() PowerUpType   { return TypeBigPaddle }
func (e *BigPaddleEffect) Target() TargetKind  { return TargetSelf }
func (e *BigPaddleEffect) Duration() uint64    { return BigPaddleDuration }
func (e *BigPaddleEffect) Name() string        { return "Big Paddle" }

func (e *BigPaddleEffect) Apply(ctx *EffectContext) {
	ctx.ActiveEffect.Data.OriginalPaddleHeight = *ctx.Collector.PaddleHeight
	*ctx.Collector.PaddleHeight = *ctx.Collector.PaddleHeight * BigPaddleMultiplier
}

func (e *BigPaddleEffect) Remove(ctx *EffectContext) {
	*ctx.Collector.PaddleHeight = ctx.ActiveEffect.Data.OriginalPaddleHeight
}

// ==================== Shrink ====================

type ShrinkEffect struct{}

func (e *ShrinkEffect) Type() PowerUpType   { return TypeShrink }
func (e *ShrinkEffect) Target() TargetKind  { return TargetOpponent }
func (e *ShrinkEffect) Duration() uint64    { return ShrinkDuration }
func (e *ShrinkEffect) Name() string        { return "Shrink" }

func (e *ShrinkEffect) Apply(ctx *EffectContext) {
	ctx.ActiveEffect.Data.OriginalPaddleHeight = *ctx.Opponent.PaddleHeight
	*ctx.Opponent.PaddleHeight = *ctx.Opponent.PaddleHeight * ShrinkMultiplier
}

func (e *ShrinkEffect) Remove(ctx *EffectContext) {
	*ctx.Opponent.PaddleHeight = ctx.ActiveEffect.Data.OriginalPaddleHeight
}

// ==================== SpeedBoost ====================

type SpeedBoostEffect struct{}

func (e *SpeedBoostEffect) Type() PowerUpType   { return TypeSpeedBoost }
func (e *SpeedBoostEffect) Target() TargetKind  { return TargetBall }
func (e *SpeedBoostEffect) Duration() uint64    { return 0 } // instant
func (e *SpeedBoostEffect) Name() string        { return "Speed Boost" }

func (e *SpeedBoostEffect) Apply(ctx *EffectContext) {
	oldSpeed := *ctx.Ball.Speed
	newSpeed := oldSpeed + SpeedBoostAmount
	if newSpeed > BallSpeedMax {
		newSpeed = BallSpeedMax
	}

	if oldSpeed > 0 {
		ratio := newSpeed / oldSpeed
		*ctx.Ball.VX *= ratio
		*ctx.Ball.VY *= ratio
	}
	*ctx.Ball.Speed = newSpeed
}

func (e *SpeedBoostEffect) Remove(ctx *EffectContext) {
	// Instant — no removal needed
}

// ==================== CannonShot ====================

type CannonShotEffect struct{}

func (e *CannonShotEffect) Type() PowerUpType   { return TypeCannonShot }
func (e *CannonShotEffect) Target() TargetKind  { return TargetSelf }
func (e *CannonShotEffect) Duration() uint64    { return CannonShotWindow }
func (e *CannonShotEffect) Name() string        { return "Cannon Shot" }

func (e *CannonShotEffect) Apply(ctx *EffectContext) {
	ctx.ActiveEffect.Data.CannonArmed = true
}

func (e *CannonShotEffect) Remove(ctx *EffectContext) {
	// Window expired without use — nothing to undo
	ctx.ActiveEffect.Data.CannonArmed = false
}

// ==================== Freeze ====================

type FreezeEffect struct{}

func (e *FreezeEffect) Type() PowerUpType   { return TypeFreeze }
func (e *FreezeEffect) Target() TargetKind  { return TargetOpponent }
func (e *FreezeEffect) Duration() uint64    { return FreezeDuration }
func (e *FreezeEffect) Name() string        { return "Freeze" }

func (e *FreezeEffect) Apply(ctx *EffectContext) {
	*ctx.Opponent.Frozen = true
}

func (e *FreezeEffect) Remove(ctx *EffectContext) {
	*ctx.Opponent.Frozen = false
}

// ==================== ReverseControls ====================

type ReverseControlsEffect struct{}

func (e *ReverseControlsEffect) Type() PowerUpType   { return TypeReverseControls }
func (e *ReverseControlsEffect) Target() TargetKind  { return TargetOpponent }
func (e *ReverseControlsEffect) Duration() uint64    { return ReverseControlsDuration }
func (e *ReverseControlsEffect) Name() string        { return "Reverse Controls" }

func (e *ReverseControlsEffect) Apply(ctx *EffectContext) {
	*ctx.Opponent.Reversed = true
}

func (e *ReverseControlsEffect) Remove(ctx *EffectContext) {
	*ctx.Opponent.Reversed = false
}

// ==================== GhostBall ====================

type GhostBallEffect struct{}

func (e *GhostBallEffect) Type() PowerUpType   { return TypeGhostBall }
func (e *GhostBallEffect) Target() TargetKind  { return TargetBall }
func (e *GhostBallEffect) Duration() uint64    { return GhostBallDuration }
func (e *GhostBallEffect) Name() string        { return "Ghost Ball" }

func (e *GhostBallEffect) Apply(ctx *EffectContext) {
	*ctx.Ball.Invisible = true
}

func (e *GhostBallEffect) Remove(ctx *EffectContext) {
	*ctx.Ball.Invisible = false
}

// ==================== Shield ====================

type ShieldEffect struct{}

func (e *ShieldEffect) Type() PowerUpType   { return TypeShield }
func (e *ShieldEffect) Target() TargetKind  { return TargetSelf }
func (e *ShieldEffect) Duration() uint64    { return ShieldDuration }
func (e *ShieldEffect) Name() string        { return "Shield" }

func (e *ShieldEffect) Apply(ctx *EffectContext) {
	data := &ctx.ActiveEffect.Data

	// Position the shield 50px in front of the collector's goal line
	if ctx.Collector.Side == 0 { // Left side
		data.ShieldX = PaddleMarginX + ShieldOffsetFromGoal
		data.ShieldSide = 0
	} else { // Right side
		data.ShieldX = ArenaWidth - PaddleMarginX - ShieldOffsetFromGoal
		data.ShieldSide = 1
	}

	data.ShieldY = ArenaHeight / 2
	data.ShieldWidth = ShieldWidth
	data.ShieldHeight = ShieldHeight
}

func (e *ShieldEffect) Remove(ctx *EffectContext) {
	// Clear shield data
	ctx.ActiveEffect.Data.ShieldX = 0
	ctx.ActiveEffect.Data.ShieldY = 0
	ctx.ActiveEffect.Data.ShieldWidth = 0
	ctx.ActiveEffect.Data.ShieldHeight = 0
}

// ==================== MultiBall ====================

type MultiBallEffect struct{}

func (e *MultiBallEffect) Type() PowerUpType  { return TypeMultiBall }
func (e *MultiBallEffect) Target() TargetKind { return TargetBall }
func (e *MultiBallEffect) Duration() uint64   { return MultiBallDuration }
func (e *MultiBallEffect) Name() string       { return "Multi-Ball" }

func (e *MultiBallEffect) Apply(ctx *EffectContext) {
	// Marker only — actual ball spawning done by GameRoom
}

func (e *MultiBallEffect) Remove(ctx *EffectContext) {
	// Marker only — cleanup done by GameRoom
}

// ==================== Helpers ====================

// ApplyCannonShot is called from physics when a paddle hit occurs
// and the hitting player has a cannon armed. Returns true if cannon was fired.
func ApplyCannonShot(effect *ActiveEffect, ballVX, ballVY, ballSpeed *float64, hitterSide int) bool {
	if effect == nil || effect.Type != TypeCannonShot || !effect.Data.CannonArmed {
		return false
	}

	effect.Data.CannonArmed = false

	// Calculate current angle
	angle := math.Atan2(-*ballVY, math.Abs(*ballVX))

	direction := 1.0
	if hitterSide == 1 { // Right side
		direction = -1.0
	}

	*ballSpeed = BallSpeedMax
	*ballVX = direction * BallSpeedMax * math.Cos(angle)
	*ballVY = -BallSpeedMax * math.Sin(angle)

	return true
}
