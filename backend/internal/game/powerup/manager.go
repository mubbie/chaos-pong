package powerup

import (
	"log"
	"math/rand"
)

const (
	SpawnIntervalMinTicks = 300  // 5 seconds minimum between spawns
	SpawnIntervalMaxTicks = 720  // 12 seconds maximum
	PowerUpCollisionSize  = 20.0 // Radius for ball-powerup collision
	SpawnZoneMinX         = 250.0
	SpawnZoneMaxX         = 550.0
	SpawnZoneMinY         = 80.0
	SpawnZoneMaxY         = 520.0
)

// Manager orchestrates power-up spawning, collection, effects, and expiry.
type Manager struct {
	Spawned       *SpawnedPowerUp // Current uncollected power-up on field (nil = none)
	Effects       []ActiveEffect  // Currently active effects
	LastHitterID  string          // Player who last hit the ball
	NextSpawnTick uint64          // Tick when next spawn should occur
	CurrentTick   uint64
	SpawnEnabled  bool
}

// NewManager creates a new power-up manager.
func NewManager() *Manager {
	return &Manager{
		SpawnEnabled:  true,
		NextSpawnTick: uint64(SpawnIntervalMinTicks + rand.Intn(SpawnIntervalMaxTicks-SpawnIntervalMinTicks)),
		Effects:       make([]ActiveEffect, 0),
	}
}

// Tick is called every game tick. Handles spawning and effect expiry.
func (m *Manager) Tick(tick uint64, buildCtx func(ownerID string) *EffectContext) {
	m.CurrentTick = tick

	// Spawn logic
	if m.SpawnEnabled && m.Spawned == nil && tick >= m.NextSpawnTick {
		m.spawn()
	}

	// Expire effects
	m.expireEffects(buildCtx)
}

func (m *Manager) spawn() {
	types := AllTypes()
	if len(types) == 0 {
		return
	}
	chosen := types[rand.Intn(len(types))]

	m.Spawned = &SpawnedPowerUp{
		Type:   chosen,
		X:      SpawnZoneMinX + rand.Float64()*(SpawnZoneMaxX-SpawnZoneMinX),
		Y:      SpawnZoneMinY + rand.Float64()*(SpawnZoneMaxY-SpawnZoneMinY),
		Size:   PowerUpCollisionSize,
		Active: true,
	}

	log.Printf("[powerup] spawned type %d at (%.0f, %.0f)", chosen, m.Spawned.X, m.Spawned.Y)
}

// CheckCollection tests ball-vs-powerup collision.
// Returns true if collected.
func (m *Manager) CheckCollection(ballX, ballY, ballSize float64) bool {
	if m.Spawned == nil || !m.Spawned.Active {
		return false
	}

	// Circle-circle collision
	dx := ballX - m.Spawned.X
	dy := ballY - m.Spawned.Y
	distSq := dx*dx + dy*dy
	threshold := (ballSize/2 + m.Spawned.Size)
	thresholdSq := threshold * threshold

	if distSq <= thresholdSq {
		m.Spawned.Active = false
		return true
	}
	return false
}

// Collect processes the collection: creates the effect, applies it, schedules next spawn.
func (m *Manager) Collect(ctx *EffectContext) {
	if m.Spawned == nil {
		return
	}

	factory, ok := Registry[m.Spawned.Type]
	if !ok {
		log.Printf("[powerup] unknown type %d", m.Spawned.Type)
		m.Spawned = nil
		m.scheduleNextSpawn()
		return
	}

	effect := factory()

	// Remove any existing effect of the same type to prevent stacking bugs.
	// e.g. two BigPaddle effects would compound heights and break Remove().
	m.removeExistingEffectOfType(m.Spawned.Type, ctx.Collector.ID, effect.Target(), ctx)

	// Remove conflicting size effects to prevent cross-type stacking.
	// e.g. BigPaddle + Shrink on the same paddle would save wrong original heights.
	m.removeConflictingSizeEffect(m.Spawned.Type, ctx)

	active := ActiveEffect{
		Type:          m.Spawned.Type,
		OwnerPlayerID: ctx.Collector.ID,
		TargetKind:    effect.Target(),
		StartTick:     m.CurrentTick,
		DurationTicks: effect.Duration(),
	}
	ctx.ActiveEffect = &active

	effect.Apply(ctx)

	log.Printf("[powerup] %s collected by %s", effect.Name(), ctx.Collector.ID)

	// Only store duration-based effects for tracking/expiry
	if effect.Duration() > 0 {
		m.Effects = append(m.Effects, active)
	}

	m.Spawned = nil
	m.scheduleNextSpawn()
}

// removeExistingEffectOfType removes any active effect of the same type that
// would conflict with a new collection. This prevents stacking bugs where
// Remove() restores the wrong state (e.g. compounded paddle heights).
func (m *Manager) removeExistingEffectOfType(
	effectType PowerUpType,
	collectorID string,
	target TargetKind,
	ctx *EffectContext,
) {
	remaining := m.Effects[:0]
	for i := range m.Effects {
		e := &m.Effects[i]
		if e.Type == effectType {
			// Remove the old effect properly before replacing it
			oldFactory, ok := Registry[e.Type]
			if ok {
				oldEffect := oldFactory()
				// Build context for the old effect's owner
				oldCtx := ctx // May need adjustment if owner differs
				if e.OwnerPlayerID != collectorID {
					// Different owner — we need the correct context.
					// For opponent-targeting effects (Freeze, Shrink, Reverse),
					// the context is already correct since collector/opponent refs
					// are set up relative to the new collector.
					// But the old effect may have been owned by the other player.
					// We swap collector/opponent in the context for removal.
					oldCtx = &EffectContext{
						Collector: ctx.Opponent,
						Opponent:  ctx.Collector,
						Ball:      ctx.Ball,
					}
				}
				oldCtx.ActiveEffect = e
				oldEffect.Remove(oldCtx)
				log.Printf("[powerup] replaced existing %s for dedup", oldEffect.Name())
			}
		} else {
			remaining = append(remaining, *e)
		}
	}
	m.Effects = remaining
}

// removeConflictingSizeEffect removes the opposite size-modifier (BigPaddle vs Shrink)
// when it targets the same paddle as the new effect, preventing corrupted original heights.
// BigPaddle targets Self (collector's paddle); Shrink targets Opponent (opponent's paddle).
// A conflicting effect is one owned by the OPPONENT that modifies the same paddle.
func (m *Manager) removeConflictingSizeEffect(newType PowerUpType, ctx *EffectContext) {
	var oppositeType PowerUpType
	if newType == TypeBigPaddle {
		oppositeType = TypeShrink
	} else if newType == TypeShrink {
		oppositeType = TypeBigPaddle
	} else {
		return // Not a size effect
	}

	opponentID := ctx.Opponent.ID
	remaining := m.Effects[:0]
	for i := range m.Effects {
		e := &m.Effects[i]
		if e.Type == oppositeType && e.OwnerPlayerID == opponentID {
			// This effect targets the same paddle — remove it first
			oldFactory, ok := Registry[e.Type]
			if ok {
				oldEffect := oldFactory()
				// Build context for the old effect: swap collector/opponent
				oldCtx := &EffectContext{
					Collector: ctx.Opponent,
					Opponent:  ctx.Collector,
					Ball:      ctx.Ball,
				}
				oldCtx.ActiveEffect = e
				oldEffect.Remove(oldCtx)
				log.Printf("[powerup] removed conflicting %s to prevent size stacking", oldEffect.Name())
			}
		} else {
			remaining = append(remaining, *e)
		}
	}
	m.Effects = remaining
}

func (m *Manager) expireEffects(buildCtx func(ownerID string) *EffectContext) {
	remaining := m.Effects[:0]
	for i := range m.Effects {
		e := &m.Effects[i]
		if m.CurrentTick >= e.StartTick+e.DurationTicks {
			// Effect expired — call Remove
			factory, ok := Registry[e.Type]
			if ok {
				effect := factory()
				ctx := buildCtx(e.OwnerPlayerID)
				if ctx != nil {
					ctx.ActiveEffect = e
					effect.Remove(ctx)
					log.Printf("[powerup] %s expired for %s", effect.Name(), e.OwnerPlayerID)
				}
			}
		} else {
			remaining = append(remaining, *e)
		}
	}
	m.Effects = remaining
}

// DiscardSpawned clears the spawned power-up without applying it
// and schedules the next spawn. Used when a power-up is collected but
// no valid collector context exists (e.g. no one has hit the ball yet).
func (m *Manager) DiscardSpawned() {
	m.Spawned = nil
	m.scheduleNextSpawn()
	log.Printf("[powerup] discarded uncollectable power-up, scheduling next spawn")
}

// SetLastHitter records who last touched the ball.
func (m *Manager) SetLastHitter(playerID string) {
	m.LastHitterID = playerID
}

// HasEffectOnPlayer checks if a player has a specific active effect.
// Returns the effect if found, nil otherwise.
func (m *Manager) HasEffectOnPlayer(playerID string, effectType PowerUpType) *ActiveEffect {
	for i := range m.Effects {
		if m.Effects[i].OwnerPlayerID == playerID && m.Effects[i].Type == effectType {
			return &m.Effects[i]
		}
	}
	return nil
}

// PlayerHasCannonArmed checks if a player has an armed cannon shot.
func (m *Manager) PlayerHasCannonArmed(playerID string) bool {
	e := m.HasEffectOnPlayer(playerID, TypeCannonShot)
	return e != nil && e.Data.CannonArmed
}

// GetShieldEffect returns the active shield effect, if any.
func (m *Manager) GetShieldEffect() *ActiveEffect {
	for i := range m.Effects {
		if m.Effects[i].Type == TypeShield {
			return &m.Effects[i]
		}
	}
	return nil
}

// OnScore clears all active effects and the spawned power-up (clean slate per point).
func (m *Manager) OnScore(buildCtx func(ownerID string) *EffectContext) {
	// Remove all effects (calling Remove on each)
	for i := range m.Effects {
		e := &m.Effects[i]
		factory, ok := Registry[e.Type]
		if ok {
			effect := factory()
			ctx := buildCtx(e.OwnerPlayerID)
			if ctx != nil {
				ctx.ActiveEffect = e
				effect.Remove(ctx)
			}
		}
	}
	m.Effects = m.Effects[:0]

	// Clear spawned power-up
	m.Spawned = nil

	// Reset last hitter so a new serve can't attribute a power-up
	// to whoever hit the ball in the previous rally.
	m.LastHitterID = ""

	// Schedule next spawn
	m.scheduleNextSpawn()
}

func (m *Manager) scheduleNextSpawn() {
	delay := SpawnIntervalMinTicks + rand.Intn(SpawnIntervalMaxTicks-SpawnIntervalMinTicks)
	m.NextSpawnTick = m.CurrentTick + uint64(delay)
}
