package game

import "math"

// updatePaddles moves paddles based on current input and dt.
func (r *GameRoom) updatePaddles(dt float64) {
	movePaddle := func(p *Player, dt float64) {
		p.Paddle.Y += float64(p.Input) * PaddleSpeed * dt

		// Clamp to arena bounds
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

// checkPaddleCollisions checks and resolves paddle-ball collisions.
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

	// Push ball out of paddle to prevent re-collision
	halfBall := r.Ball.Size / 2
	if p.Side == SideLeft {
		r.Ball.X = contactX + halfBall
	} else {
		r.Ball.X = contactX - halfBall
	}
}

// checkScoring checks if ball passed left/right boundary.
// Returns (scored bool, scoringSide PlayerSide).
func (r *GameRoom) checkScoring() (bool, PlayerSide) {
	halfBall := r.Ball.Size / 2

	// Ball passed left boundary — Player2 (right) scores
	if r.Ball.X-halfBall <= 0 {
		return true, SideRight
	}

	// Ball passed right boundary — Player1 (left) scores
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

	direction := 1.0
	if serveToward == SideLeft {
		direction = -1.0
	}

	r.Ball.VX = direction * BallSpeedInit
	r.Ball.VY = 0
}
