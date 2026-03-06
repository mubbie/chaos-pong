package game

import (
	"math"

	"github.com/mubbie/chaos-pong/backend/internal/game/powerup"
)

// updatePaddles moves paddles based on current input and dt.
// Respects Frozen (skip movement) and Reversed (negate direction) effects.
func (r *GameRoom) updatePaddles(dt float64) {
	movePaddle := func(p *Player, dt float64) {
		// Frozen players cannot move
		if p.Frozen {
			return
		}

		dir := float64(p.Input)

		// Reversed controls: negate direction
		if p.Reversed {
			dir = -dir
		}

		p.Paddle.Y += dir * PaddleSpeed * dt

		// Clamp to arena bounds (uses current effective paddle height)
		halfH := p.Paddle.Height / 2
		if p.Paddle.Y-halfH < 0 {
			p.Paddle.Y = halfH
		}
		if p.Paddle.Y+halfH > ArenaHeight {
			p.Paddle.Y = ArenaHeight - halfH
		}
	}

	movePaddle(r.Player1, dt)
	movePaddle(r.Player2, dt)

	// Track paddle movement distance
	r.Stats.P1PaddleDistance += math.Abs(r.Player1.Paddle.Y - r.prevP1Y)
	r.Stats.P2PaddleDistance += math.Abs(r.Player2.Paddle.Y - r.prevP2Y)
	r.prevP1Y = r.Player1.Paddle.Y
	r.prevP2Y = r.Player2.Paddle.Y
}

// updateBall moves the ball based on velocity and dt.
func (r *GameRoom) updateBall(dt float64) {
	r.Ball.X += r.Ball.VX * dt
	r.Ball.Y += r.Ball.VY * dt
}

// checkWallCollisions bounces the ball off top/bottom walls.
func (r *GameRoom) checkWallCollisions() {
	halfSize := r.Ball.Size / 2

	if r.Ball.Y-halfSize <= 0 {
		r.Ball.Y = halfSize
		r.Ball.VY = -r.Ball.VY
	}
	if r.Ball.Y+halfSize >= ArenaHeight {
		r.Ball.Y = ArenaHeight - halfSize
		r.Ball.VY = -r.Ball.VY
	}
}

// checkShieldCollision bounces the ball off an active shield wall.
func (r *GameRoom) checkShieldCollision() {
	shield := r.PowerUps.GetShieldEffect()
	if shield == nil {
		return
	}

	sd := shield.Data
	halfBall := r.Ball.Size / 2

	shieldLeft := sd.ShieldX - sd.ShieldWidth/2
	shieldRight := sd.ShieldX + sd.ShieldWidth/2
	shieldTop := sd.ShieldY - sd.ShieldHeight/2
	shieldBottom := sd.ShieldY + sd.ShieldHeight/2

	// Shield on left side (protecting left player's goal)
	if sd.ShieldSide == 0 && r.Ball.VX < 0 {
		if r.Ball.X-halfBall <= shieldRight &&
			r.Ball.X+halfBall >= shieldLeft &&
			r.Ball.Y+halfBall >= shieldTop &&
			r.Ball.Y-halfBall <= shieldBottom {
			r.Ball.VX = -r.Ball.VX
			r.Ball.X = shieldRight + halfBall
		}
	}

	// Shield on right side (protecting right player's goal)
	if sd.ShieldSide == 1 && r.Ball.VX > 0 {
		if r.Ball.X+halfBall >= shieldLeft &&
			r.Ball.X-halfBall <= shieldRight &&
			r.Ball.Y+halfBall >= shieldTop &&
			r.Ball.Y-halfBall <= shieldBottom {
			r.Ball.VX = -r.Ball.VX
			r.Ball.X = shieldLeft - halfBall
		}
	}
}

// checkPaddleCollisions checks and resolves paddle-ball collisions.
// Also tracks the last hitter for power-up collection attribution
// and applies cannon shot effect on hit.
func (r *GameRoom) checkPaddleCollisions() {
	halfBall := r.Ball.Size / 2

	// Left paddle (Player1)
	p1 := r.Player1
	if r.Ball.VX < 0 { // Ball moving left
		paddleRight := p1.Paddle.X + p1.Paddle.Width/2
		paddleTop := p1.Paddle.Y - p1.Paddle.Height/2
		paddleBottom := p1.Paddle.Y + p1.Paddle.Height/2

		if r.Ball.X-halfBall <= paddleRight &&
			r.Ball.X-halfBall >= p1.Paddle.X-p1.Paddle.Width/2 &&
			r.Ball.Y+halfBall >= paddleTop &&
			r.Ball.Y-halfBall <= paddleBottom {

			r.bounceBallOffPaddle(p1, paddleRight)
			r.PowerUps.SetLastHitter(p1.ID)
			r.tryCannonShot(p1)
			r.currentRally++
			r.paddleHitThisTick = true
		}
	}

	// Right paddle (Player2)
	p2 := r.Player2
	if r.Ball.VX > 0 { // Ball moving right
		paddleLeft := p2.Paddle.X - p2.Paddle.Width/2
		paddleTop := p2.Paddle.Y - p2.Paddle.Height/2
		paddleBottom := p2.Paddle.Y + p2.Paddle.Height/2

		if r.Ball.X+halfBall >= paddleLeft &&
			r.Ball.X+halfBall <= p2.Paddle.X+p2.Paddle.Width/2 &&
			r.Ball.Y+halfBall >= paddleTop &&
			r.Ball.Y-halfBall <= paddleBottom {

			r.bounceBallOffPaddle(p2, paddleLeft)
			r.PowerUps.SetLastHitter(p2.ID)
			r.tryCannonShot(p2)
			r.currentRally++
			r.paddleHitThisTick = true
		}
	}
}

// tryCannonShot checks if the player has an armed cannon and fires it.
func (r *GameRoom) tryCannonShot(p *Player) {
	effect := r.PowerUps.HasEffectOnPlayer(p.ID, powerup.TypeCannonShot)
	if effect != nil {
		powerup.ApplyCannonShot(effect, &r.Ball.VX, &r.Ball.VY, &r.Ball.Speed, int(p.Side))
		// Track fastest ball speed after cannon shot
		if r.Ball.Speed > r.Stats.FastestBallSpeed {
			r.Stats.FastestBallSpeed = r.Ball.Speed
		}
	}
}

// bounceBallOffPaddle applies angle-based bounce and speed increase.
func (r *GameRoom) bounceBallOffPaddle(p *Player, contactX float64) {
	// Where on the paddle did the ball hit? (-1 = top edge, +1 = bottom edge)
	relativeIntersect := (p.Paddle.Y - r.Ball.Y) / (p.Paddle.Height / 2)
	// Clamp to [-1, 1]
	if relativeIntersect > 1 {
		relativeIntersect = 1
	}
	if relativeIntersect < -1 {
		relativeIntersect = -1
	}

	bounceAngle := relativeIntersect * MaxBounceAngle

	// Increase speed
	r.Ball.Speed += BallSpeedInc
	if r.Ball.Speed > BallSpeedMax {
		r.Ball.Speed = BallSpeedMax
	}

	// Determine horizontal direction
	direction := 1.0
	if p.Side == SideRight {
		direction = -1.0
	}

	r.Ball.VX = direction * r.Ball.Speed * math.Cos(bounceAngle)
	r.Ball.VY = -r.Ball.Speed * math.Sin(bounceAngle)

	// Track fastest ball speed
	if r.Ball.Speed > r.Stats.FastestBallSpeed {
		r.Stats.FastestBallSpeed = r.Ball.Speed
	}

	// Push ball out of paddle to prevent re-collision
	halfBall := r.Ball.Size / 2
	if p.Side == SideLeft {
		r.Ball.X = contactX + halfBall
	} else {
		r.Ball.X = contactX - halfBall
	}
}

// checkScoring checks if ball edge has reached or crossed a goal line.
// Returns (scored bool, scoringSide PlayerSide).
func (r *GameRoom) checkScoring() (bool, PlayerSide) {
	halfBall := r.Ball.Size / 2

	// Ball edge reached left goal line — Player2 (right) scores
	if r.Ball.X-halfBall <= 0 {
		return true, SideRight
	}

	// Ball edge reached right goal line — Player1 (left) scores
	if r.Ball.X+halfBall >= ArenaWidth {
		return true, SideLeft
	}

	return false, SideLeft
}

// resetBall places ball at center with initial velocity toward given side.
func (r *GameRoom) resetBall(serveToward PlayerSide) {
	r.Ball.X = ArenaWidth / 2
	r.Ball.Y = ArenaHeight / 2
	r.Ball.Speed = BallSpeedInit
	r.Ball.Size = BallSize
	r.Ball.Invisible = false

	direction := 1.0
	if serveToward == SideLeft {
		direction = -1.0
	}

	r.Ball.VX = direction * BallSpeedInit
	r.Ball.VY = 0
}

// updateExtraBall moves an extra ball based on velocity and dt.
func (r *GameRoom) updateExtraBall(ball *Ball, dt float64) {
	ball.X += ball.VX * dt
	ball.Y += ball.VY * dt
}

// checkExtraBallWalls bounces an extra ball off top/bottom walls.
func (r *GameRoom) checkExtraBallWalls(ball *Ball) {
	halfSize := ball.Size / 2
	if ball.Y-halfSize <= 0 {
		ball.Y = halfSize
		ball.VY = -ball.VY
	}
	if ball.Y+halfSize >= ArenaHeight {
		ball.Y = ArenaHeight - halfSize
		ball.VY = -ball.VY
	}
}

// checkExtraBallPaddle checks paddle collisions for extra balls.
func (r *GameRoom) checkExtraBallPaddle(ball *Ball) {
	halfBall := ball.Size / 2

	// Left paddle
	p1 := r.Player1
	if ball.VX < 0 {
		paddleRight := p1.Paddle.X + p1.Paddle.Width/2
		paddleTop := p1.Paddle.Y - p1.Paddle.Height/2
		paddleBottom := p1.Paddle.Y + p1.Paddle.Height/2
		if ball.X-halfBall <= paddleRight &&
			ball.X-halfBall >= p1.Paddle.X-p1.Paddle.Width/2 &&
			ball.Y+halfBall >= paddleTop &&
			ball.Y-halfBall <= paddleBottom {
			ball.VX = -ball.VX
			ball.X = paddleRight + halfBall
		}
	}

	// Right paddle
	p2 := r.Player2
	if ball.VX > 0 {
		paddleLeft := p2.Paddle.X - p2.Paddle.Width/2
		paddleTop := p2.Paddle.Y - p2.Paddle.Height/2
		paddleBottom := p2.Paddle.Y + p2.Paddle.Height/2
		if ball.X+halfBall >= paddleLeft &&
			ball.X+halfBall <= p2.Paddle.X+p2.Paddle.Width/2 &&
			ball.Y+halfBall >= paddleTop &&
			ball.Y-halfBall <= paddleBottom {
			ball.VX = -ball.VX
			ball.X = paddleLeft - halfBall
		}
	}
}

// checkExtraBallScoring checks if an extra ball has reached a goal line.
func (r *GameRoom) checkExtraBallScoring(ball *Ball) (bool, PlayerSide) {
	halfBall := ball.Size / 2
	if ball.X-halfBall <= 0 {
		return true, SideRight
	}
	if ball.X+halfBall >= ArenaWidth {
		return true, SideLeft
	}
	return false, SideLeft
}
