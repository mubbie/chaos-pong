package game

import "time"

const (
	TickRate     = 60
	TickDuration = time.Second / TickRate // ~16.67ms

	ArenaWidth  = 800.0
	ArenaHeight = 600.0

	PaddleWidth   = 15.0
	PaddleHeight  = 100.0
	PaddleSpeed   = 400.0 // pixels per second
	PaddleMarginX = 30.0  // distance from arena edge to paddle center

	BallSize      = 15.0
	BallSpeedInit = 300.0 // initial speed in pixels/sec
	BallSpeedMax  = 600.0 // speed cap
	BallSpeedInc  = 15.0  // speed increase per paddle hit

	MaxBounceAngle = 1.0472 // 60 degrees in radians

	WinScore       = 11
	CountdownTicks = TickRate * 3 // 3 seconds of countdown
)
