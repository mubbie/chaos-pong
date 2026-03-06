package powerup

// Registry maps PowerUpType to a factory function that creates the effect.
var Registry = map[PowerUpType]func() PowerUpEffect{}

func init() {
	Register(TypeBigPaddle, func() PowerUpEffect { return &BigPaddleEffect{} })
	Register(TypeShrink, func() PowerUpEffect { return &ShrinkEffect{} })
	Register(TypeSpeedBoost, func() PowerUpEffect { return &SpeedBoostEffect{} })
	Register(TypeCannonShot, func() PowerUpEffect { return &CannonShotEffect{} })
	Register(TypeFreeze, func() PowerUpEffect { return &FreezeEffect{} })
	Register(TypeReverseControls, func() PowerUpEffect { return &ReverseControlsEffect{} })
	Register(TypeGhostBall, func() PowerUpEffect { return &GhostBallEffect{} })
	Register(TypeShield, func() PowerUpEffect { return &ShieldEffect{} })
	Register(TypeMultiBall, func() PowerUpEffect { return &MultiBallEffect{} })
}

// Register adds a power-up type to the registry.
func Register(t PowerUpType, factory func() PowerUpEffect) {
	Registry[t] = factory
}

// AllTypes returns all registered power-up types for random selection.
func AllTypes() []PowerUpType {
	types := make([]PowerUpType, 0, len(Registry))
	for t := range Registry {
		types = append(types, t)
	}
	return types
}
