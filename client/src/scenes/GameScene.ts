import Phaser from 'phaser';
import { SocketManager } from '../network/socket';
import { SynthAudio } from '../audio/SynthAudio';
import type { GameStartPayload, GameStatePayload, GameEndPayload } from '../types/messages';
import { GameStatus } from '../types/messages';

const COUNTDOWN_TICKS = 180; // 3 seconds * 60 ticks/sec
const WIN_SCORE = 11;

// Neon color palette
const P1_COLOR = 0x00f5ff; // cyan
const P2_COLOR = 0xff00e5; // magenta
const CENTER_LINE_COLOR = 0x6b21a8; // purple

// Commentary pools
const HIT_COMMENTS = ['NICE!', 'POW!', 'SMACK!', 'BOOM!', 'CRACK!'];
const RALLY_COMMENTS = ['ON FIRE!', 'UNSTOPPABLE!', 'INSANE RALLY!', 'LEGENDARY!'];
const GOAL_COMMENTS = ['GOAAL!', 'OHHH!', 'SAVAGE!', 'DENIED!', 'BRUTAL!'];

// Speed tier thresholds
const SPEED_TIERS = [
  { speed: 400, text: 'FAST!', color: '#ffff00' },
  { speed: 480, text: 'BLAZING!', color: '#ff8800' },
  { speed: 550, text: 'INSANE!', color: '#ff0044' },
];

export class GameScene extends Phaser.Scene {
  // Game objects
  private leftPaddleGfx!: Phaser.GameObjects.Graphics;
  private rightPaddleGfx!: Phaser.GameObjects.Graphics;
  private leftPaddleGlow!: Phaser.GameObjects.Graphics;
  private rightPaddleGlow!: Phaser.GameObjects.Graphics;
  private ball!: Phaser.GameObjects.Arc;
  private ballGlow!: Phaser.GameObjects.Graphics;
  private trailGraphics!: Phaser.GameObjects.Graphics;
  private centerLine!: Phaser.GameObjects.Graphics;
  private p1NameText!: Phaser.GameObjects.Text;
  private p2NameText!: Phaser.GameObjects.Text;
  private p1ScoreText!: Phaser.GameObjects.Text;
  private p2ScoreText!: Phaser.GameObjects.Text;
  private dashText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;

  // State
  private gameData!: GameStartPayload;
  private lastDirection: number = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wKey!: Phaser.Input.Keyboard.Key;
  private sKey!: Phaser.Input.Keyboard.Key;

  // Effect state
  private prevState: GameStatePayload | null = null;
  private lastCountdownNum: number = 0;
  private ballColor: number = 0xffffff;
  private trailPositions: { x: number; y: number }[] = [];
  private readonly TRAIL_LENGTH = 12;

  // Particles
  private paddleHitEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private wallHitEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  // Audio
  private audio!: SynthAudio;

  // Paddle positions for drawing
  private leftPaddleY: number = 0;
  private rightPaddleY: number = 0;

  // Rally tracking
  private rallyCount: number = 0;
  private rallyText!: Phaser.GameObjects.Text;

  // Alert text (match point, deuce, advantage)
  private alertText!: Phaser.GameObjects.Text;
  private lastAlertMsg: string = '';

  // Ripple effects
  private rippleGraphics!: Phaser.GameObjects.Graphics;
  private activeRipples: { x: number; y: number; radius: number; maxRadius: number; color: number; startTime: number }[] = [];

  // Background intensity overlay
  private bgOverlay!: Phaser.GameObjects.Graphics;
  private bgIntensity: number = 0;

  // Speed text tracking
  private lastSpeedTier: number = -1;

  // Momentum tracking
  private lastScorerSide: 'left' | 'right' | null = null;
  private scoringStreak: number = 0;
  private momentumGlow!: Phaser.GameObjects.Graphics;

  // Lightning effect
  private lightningGraphics!: Phaser.GameObjects.Graphics;

  // Paddle trail (afterglow when moving fast)
  private paddleTrailGfx!: Phaser.GameObjects.Graphics;
  private prevLeftPaddleY: number = 0;
  private prevRightPaddleY: number = 0;

  // Streak flames emitter
  private flameEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  // Camera rally zoom
  private targetZoom: number = 1;

  // Ball squash & stretch
  private ballSquashGfx!: Phaser.GameObjects.Graphics;

  // Goal slow-mo
  private slowMoFrames: number = 0;
  private skipNextFrames: number = 0;

  // Arena border ref for color pulse
  private arenaBorder!: Phaser.GameObjects.Graphics;
  private borderBaseAlpha: number = 0.25;

  // Bound callbacks
  private onGameState!: (payload: GameStatePayload) => void;
  private onGameEnd!: (payload: GameEndPayload) => void;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: GameStartPayload): void {
    this.gameData = data;
    const socket = SocketManager.getInstance();
    socket.setIdentity(data.you.id, data.you.name);
  }

  create(): void {
    const { arena } = this.gameData;
    this.audio = new SynthAudio();

    // Generate particle texture
    if (!this.textures.exists('particle')) {
      const pGfx = this.make.graphics({ x: 0, y: 0 });
      pGfx.fillStyle(0xffffff);
      pGfx.fillCircle(2, 2, 2);
      pGfx.generateTexture('particle', 4, 4);
      pGfx.destroy();
    }

    // --- Background elements ---

    // Background intensity overlay (behind dynamic elements)
    this.bgOverlay = this.add.graphics().setDepth(0);

    // Subtle background grid dots
    const bgDots = this.add.graphics().setDepth(0);
    for (let x = 20; x < arena.width; x += 40) {
      for (let y = 20; y < arena.height; y += 40) {
        bgDots.fillStyle(0xffffff, 0.03);
        bgDots.fillCircle(x, y, 1);
      }
    }

    // Momentum glow (behind center line)
    this.momentumGlow = this.add.graphics().setDepth(1);

    // Glowing center line
    this.centerLine = this.add.graphics().setDepth(1);
    this.drawCenterLine(0.4);
    this.tweens.addCounter({
      from: 0.3,
      to: 0.6,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      onUpdate: (tween) => {
        this.drawCenterLine(tween.getValue() as number);
      },
    });

    // Arena border (stored for goal color pulse)
    this.arenaBorder = this.add.graphics().setDepth(1);
    this.tweens.addCounter({
      from: 0.15,
      to: 0.35,
      duration: 3000,
      yoyo: true,
      repeat: -1,
      onUpdate: (tween) => {
        this.borderBaseAlpha = tween.getValue() as number;
      },
    });

    // Scanlines
    const scanlines = this.add.graphics().setDepth(100);
    for (let y = 0; y < arena.height; y += 4) {
      scanlines.fillStyle(0x000000, 0.04);
      scanlines.fillRect(0, y, arena.width, 2);
    }

    // --- Trail + Glow layers ---
    this.trailGraphics = this.add.graphics().setDepth(2);
    this.ballGlow = this.add.graphics().setDepth(3);

    // --- Ripple layer ---
    this.rippleGraphics = this.add.graphics().setDepth(2);

    // --- Lightning effect layer ---
    this.lightningGraphics = this.add.graphics().setDepth(7);

    // --- Paddle trail layer ---
    this.paddleTrailGfx = this.add.graphics().setDepth(4);

    // --- Ball squash & stretch layer (drawn instead of Arc when moving fast) ---
    this.ballSquashGfx = this.add.graphics().setDepth(6);

    // --- Paddle glows ---
    this.leftPaddleGlow = this.add.graphics().setDepth(3);
    this.rightPaddleGlow = this.add.graphics().setDepth(3);

    // --- Paddles (drawn as rounded rects) ---
    this.leftPaddleGfx = this.add.graphics().setDepth(5);
    this.rightPaddleGfx = this.add.graphics().setDepth(5);
    this.leftPaddleY = arena.height / 2;
    this.rightPaddleY = arena.height / 2;
    this.drawPaddle(this.leftPaddleGfx, 30, this.leftPaddleY, P1_COLOR);
    this.drawPaddle(this.rightPaddleGfx, arena.width - 30, this.rightPaddleY, P2_COLOR);

    // --- Ball (circle) ---
    this.ball = this.add.circle(arena.width / 2, arena.height / 2, 8, 0xffffff).setDepth(6);

    // --- Scoreboard with colored player names ---
    const p1Name = this.gameData.you.side === 'left'
      ? this.gameData.you.name : this.gameData.opponent.name;
    const p2Name = this.gameData.you.side === 'right'
      ? this.gameData.you.name : this.gameData.opponent.name;

    const scoreY = 35;
    const cx = arena.width / 2;

    this.p1NameText = this.add.text(cx - 80, scoreY, p1Name, {
      fontSize: '16px',
      color: '#00f5ff',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setDepth(10);

    this.p1ScoreText = this.add.text(cx - 30, scoreY, '0', {
      fontSize: '32px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(1, 0.5).setDepth(10);

    this.dashText = this.add.text(cx, scoreY, ':', {
      fontSize: '28px',
      color: '#6b21a8',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5).setDepth(10);

    this.p2ScoreText = this.add.text(cx + 30, scoreY, '0', {
      fontSize: '32px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(10);

    this.p2NameText = this.add.text(cx + 80, scoreY, p2Name, {
      fontSize: '16px',
      color: '#ff00e5',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(10);

    // Rally counter text
    this.rallyText = this.add.text(cx, arena.height / 2, '', {
      fontSize: '28px',
      color: '#ffff00',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(15).setAlpha(0);

    // Alert text (match point, deuce, advantage)
    this.alertText = this.add.text(cx, 80, '', {
      fontSize: '24px',
      color: '#ff4444',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(15).setAlpha(0);

    // Countdown overlay
    this.countdownText = this.add.text(arena.width / 2, arena.height / 2 - 100, '', {
      fontSize: '96px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(20);

    // --- Particle emitters ---
    this.paddleHitEmitter = this.add.particles(0, 0, 'particle', {
      speed: { min: 50, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 300,
      quantity: 12,
      emitting: false,
    }).setDepth(8);

    this.wallHitEmitter = this.add.particles(0, 0, 'particle', {
      speed: { min: 30, max: 100 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 200,
      quantity: 6,
      emitting: false,
    }).setDepth(8);

    // Streak flame emitter
    this.flameEmitter = this.add.particles(0, 0, 'particle', {
      speed: { min: 20, max: 60 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 400,
      frequency: 30,
      emitting: false,
      tint: [0xff4400, 0xff8800, 0xffcc00, 0xff0000],
    }).setDepth(4);

    // --- Keyboard input ---
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.sKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);

    // --- Subscribe to server messages ---
    const socket = SocketManager.getInstance();
    this.onGameState = (payload: GameStatePayload) => this.handleGameState(payload);
    this.onGameEnd = (payload: GameEndPayload) => this.handleGameEnd(payload);
    socket.on('game_state', this.onGameState);
    socket.on('game_end', this.onGameEnd);
  }

  update(): void {
    const up = this.cursors.up.isDown || this.wKey.isDown;
    const down = this.cursors.down.isDown || this.sKey.isDown;

    let direction = 0;
    if (up && !down) direction = -1;
    else if (down && !up) direction = 1;

    if (direction !== this.lastDirection) {
      this.lastDirection = direction;
      SocketManager.getInstance().send('player_input', { direction });
    }

    // Update ripple animations
    this.updateRipples();

    // Redraw arena border (base pulse + goal flash handled separately)
    this.arenaBorder.clear();
    this.arenaBorder.lineStyle(1, CENTER_LINE_COLOR, this.borderBaseAlpha);
    this.arenaBorder.strokeRect(0, 0, this.gameData.arena.width, this.gameData.arena.height);

    // Smooth camera zoom toward target
    const cam = this.cameras.main;
    cam.zoom += (this.targetZoom - cam.zoom) * 0.08;

    // Lightning clear each frame (redrawn in handleGameState)
    this.lightningGraphics.clear();
  }

  private handleGameState(state: GameStatePayload): void {
    // Goal slow-mo: skip some frames for dramatic pause
    if (this.skipNextFrames > 0) {
      this.skipNextFrames--;
      return;
    }

    const { arena } = this.gameData;

    // --- Event Detection ---
    let paddleHit = false;
    let wallBounce = false;
    let scored = false;
    let transitionToPlaying = false;

    if (this.prevState) {
      if (state.player1.score !== this.prevState.player1.score ||
          state.player2.score !== this.prevState.player2.score) {
        scored = true;
      }

      if (!scored) {
        if (this.prevState.ball.vx !== 0 &&
            Math.sign(state.ball.vx) !== Math.sign(this.prevState.ball.vx)) {
          paddleHit = true;
        }
        if (this.prevState.ball.vy !== 0 &&
            Math.sign(state.ball.vy) !== Math.sign(this.prevState.ball.vy)) {
          wallBounce = true;
        }
      }

      if (this.prevState.status === GameStatus.Countdown &&
          state.status === GameStatus.Playing) {
        transitionToPlaying = true;
      }
    }

    // --- Position Updates ---
    this.leftPaddleY = state.player1.paddleY;
    this.rightPaddleY = state.player2.paddleY;
    this.ball.setPosition(state.ball.x, state.ball.y);

    this.drawPaddle(this.leftPaddleGfx, 30, this.leftPaddleY, P1_COLOR);
    this.drawPaddle(this.rightPaddleGfx, arena.width - 30, this.rightPaddleY, P2_COLOR);

    this.p1ScoreText.setText(state.player1.score.toString());
    this.p2ScoreText.setText(state.player2.score.toString());

    // --- Ball Visual Effects ---
    const speed = Math.sqrt(state.ball.vx * state.ball.vx + state.ball.vy * state.ball.vy);
    this.ballColor = this.getSpeedColor(state.ball.vx, state.ball.vy);
    this.ball.setFillStyle(this.ballColor);

    // Ball grows with speed (radius 8 → 12)
    const ballRadius = 8 + 4 * Math.min(Math.max((speed - 300) / 300, 0), 1);
    this.ball.setRadius(ballRadius);

    // Ball squash & stretch at high speed
    this.drawBallSquash(state.ball.x, state.ball.y, state.ball.vx, state.ball.vy, speed, ballRadius);

    this.drawBallGlow(state.ball.x, state.ball.y, this.ballColor, ballRadius);
    this.updateTrail(state);

    // --- Paddle Trail (afterglow when moving fast) ---
    this.drawPaddleTrail(state);
    this.prevLeftPaddleY = this.leftPaddleY;
    this.prevRightPaddleY = this.rightPaddleY;

    // --- Lightning Sparks (ball near paddle) ---
    this.drawLightning(state);

    // --- Background Intensity ---
    this.updateBgIntensity(speed);

    // --- Paddle Glow ---
    this.drawPaddleGlow(this.leftPaddleGlow, 30, this.leftPaddleY, P1_COLOR);
    this.drawPaddleGlow(this.rightPaddleGlow, arena.width - 30, this.rightPaddleY, P2_COLOR);

    // --- Momentum Glow ---
    this.drawMomentumGlow();

    // --- Rally Tracking ---
    if (paddleHit) {
      this.rallyCount++;
      if (this.rallyCount >= 3) {
        this.showRally();
      }
    }
    if (scored) {
      this.rallyCount = 0;
    }

    // --- Camera Zoom on Rallies ---
    if (this.rallyCount >= 5) {
      this.targetZoom = 1 + Math.min((this.rallyCount - 5) * 0.015, 0.12);
    } else {
      this.targetZoom = 1;
    }

    // --- Streak Flames ---
    this.updateStreakFlames();

    // --- Speed Text Pop-ups ---
    if (state.status === GameStatus.Playing && !scored) {
      this.checkSpeedTier(speed, state.ball.x, state.ball.y);
    }
    if (scored) {
      this.lastSpeedTier = -1;
    }

    // --- Paddle Hit Effects ---
    if (paddleHit) {
      const hitLeft = state.ball.vx > 0;
      const hitX = hitLeft ? 30 : arena.width - 30;
      const hitColor = hitLeft ? P1_COLOR : P2_COLOR;
      const hitGfx = hitLeft ? this.leftPaddleGfx : this.rightPaddleGfx;
      const hitY = hitLeft ? this.leftPaddleY : this.rightPaddleY;

      // Flash paddle white + squash effect
      this.drawPaddleSquashed(hitGfx, hitX, hitY, 0xffffff);
      this.time.delayedCall(50, () => {
        this.drawPaddleStretched(hitGfx, hitX, hitY, hitColor);
      });
      this.time.delayedCall(120, () => {
        this.drawPaddle(hitGfx, hitX, hitY, hitColor);
      });

      // Particles
      this.paddleHitEmitter.setPosition(hitX, state.ball.y);
      this.paddleHitEmitter.setParticleTint(hitColor);
      this.paddleHitEmitter.explode(12);

      // Screen shake escalates with rally
      const shakeIntensity = Math.min(0.003 + this.rallyCount * 0.001, 0.015);
      this.cameras.main.shake(100, shakeIntensity);

      // Ripple effect
      this.addRipple(hitX, state.ball.y, hitColor);

      // Near-miss sparks (ball hits near paddle edge)
      const paddleCenterY = hitLeft ? this.leftPaddleY : this.rightPaddleY;
      const hitOffset = Math.abs(state.ball.y - paddleCenterY);
      if (hitOffset > 35) {
        this.paddleHitEmitter.setPosition(hitX, state.ball.y);
        this.paddleHitEmitter.setParticleTint(0xffff00);
        this.paddleHitEmitter.explode(8);
        this.showCommentary(hitX + (hitLeft ? 40 : -40), state.ball.y - 20,
          'EDGE!', '#ffff00');
      }

      // Commentary on high rallies
      if (this.rallyCount >= 5 && this.rallyCount % 3 === 0) {
        const comment = RALLY_COMMENTS[Math.floor(Math.random() * RALLY_COMMENTS.length)];
        this.showCommentary(arena.width / 2, arena.height / 2 - 40, comment, '#ffff00');
      } else if (Math.random() < 0.25) {
        const comment = HIT_COMMENTS[Math.floor(Math.random() * HIT_COMMENTS.length)];
        this.showCommentary(hitX + (hitLeft ? 50 : -50), state.ball.y - 25, comment,
          hitLeft ? '#00f5ff' : '#ff00e5');
      }

      this.audio.paddleHit();
    }

    // --- Wall Bounce Effects ---
    if (wallBounce) {
      const wallY = state.ball.vy > 0 ? 0 : arena.height;
      this.wallHitEmitter.setPosition(state.ball.x, wallY);
      this.wallHitEmitter.setParticleTint(this.ballColor);
      this.wallHitEmitter.explode(6);
      this.audio.wallBounce();
    }

    // --- Score Effects ---
    if (scored) {
      this.cameras.main.shake(200, 0.01);

      const p1Scored = state.player1.score !== (this.prevState?.player1.score ?? 0);
      const flashColor = p1Scored ? P1_COLOR : P2_COLOR;
      const r = (flashColor >> 16) & 0xff;
      const g = (flashColor >> 8) & 0xff;
      const b = flashColor & 0xff;
      this.cameras.main.flash(150, r, g, b);

      const changedScore = p1Scored ? this.p1ScoreText : this.p2ScoreText;
      changedScore.setScale(2);
      this.tweens.add({
        targets: changedScore,
        scaleX: 1, scaleY: 1,
        duration: 400,
        ease: 'Back.easeOut',
      });

      // Goal explosion
      this.paddleHitEmitter.setPosition(state.ball.x, state.ball.y);
      this.paddleHitEmitter.setParticleTint(0xffff00);
      this.paddleHitEmitter.explode(30);

      // Goal commentary
      const goalComment = GOAL_COMMENTS[Math.floor(Math.random() * GOAL_COMMENTS.length)];
      this.showCommentary(arena.width / 2, arena.height / 2 + 50, goalComment, '#ffff00');

      this.audio.goalScored();

      // Track momentum
      const scoringSide: 'left' | 'right' = p1Scored ? 'left' : 'right';
      if (this.lastScorerSide === scoringSide) {
        this.scoringStreak++;
      } else {
        this.scoringStreak = 1;
        this.lastScorerSide = scoringSide;
      }

      // Reset trail
      this.trailPositions = [];

      // Goal slow-mo: skip next 10 frames (~167ms dramatic pause)
      this.skipNextFrames = 10;

      // Arena border color pulse on goal
      this.pulseArenaBorder(flashColor);

      // Reset camera zoom
      this.targetZoom = 1;

      // Check for match point / deuce / advantage alerts
      this.checkScoreAlerts(state.player1.score, state.player2.score);
    }

    // --- Countdown Effects ---
    if (state.status === GameStatus.Countdown) {
      const remaining = Math.ceil((COUNTDOWN_TICKS - state.tick) / 60);
      if (remaining > 0 && remaining !== this.lastCountdownNum) {
        this.lastCountdownNum = remaining;

        const colors = ['#ffffff', '#ff00e5', '#00f5ff'];
        const color = colors[remaining - 1] || '#ffffff';

        this.countdownText.setText(remaining.toString());
        this.countdownText.setColor(color);
        this.countdownText.setVisible(true);
        this.countdownText.setScale(2).setAlpha(1);
        this.tweens.add({
          targets: this.countdownText,
          scaleX: 1, scaleY: 1, alpha: 0.3,
          duration: 800,
          ease: 'Power2',
        });
        this.audio.countdownBeep(remaining);
      }
    } else if (transitionToPlaying) {
      this.countdownText.setText('GO!');
      this.countdownText.setColor('#22c55e');
      this.countdownText.setVisible(true);
      this.countdownText.setScale(2).setAlpha(1);
      this.tweens.add({
        targets: this.countdownText,
        scaleX: 3, scaleY: 3, alpha: 0,
        duration: 500,
        ease: 'Power2',
        onComplete: () => this.countdownText.setVisible(false),
      });
      this.audio.goSound();
      this.lastCountdownNum = 0;
    } else {
      this.countdownText.setVisible(false);
    }

    // --- Save State ---
    this.prevState = {
      ...state,
      ball: { ...state.ball },
      player1: { ...state.player1 },
      player2: { ...state.player2 },
    };
  }

  // --- Commentary ---

  private showCommentary(x: number, y: number, text: string, color: string): void {
    const txt = this.add.text(x, y, text, {
      fontSize: '20px',
      color,
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(18).setAlpha(1);

    this.tweens.add({
      targets: txt,
      y: y - 60,
      alpha: 0,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 800,
      ease: 'Power2',
      onComplete: () => txt.destroy(),
    });
  }

  // --- Rally Display ---

  private showRally(): void {
    const rallySize = Math.min(20 + this.rallyCount * 2, 48);
    const rallyColors = ['#ffff00', '#ff8800', '#ff0044', '#ff00e5'];
    const colorIdx = Math.min(Math.floor((this.rallyCount - 3) / 3), rallyColors.length - 1);

    this.rallyText.setText(`${this.rallyCount}x RALLY!`);
    this.rallyText.setFontSize(rallySize + 'px');
    this.rallyText.setColor(rallyColors[colorIdx]);
    this.rallyText.setAlpha(0.8);
    this.rallyText.setScale(1.3);

    this.tweens.killTweensOf(this.rallyText);

    this.tweens.add({
      targets: this.rallyText,
      scaleX: 1, scaleY: 1,
      duration: 200,
      ease: 'Back.easeOut',
    });

    this.tweens.add({
      targets: this.rallyText,
      alpha: 0,
      duration: 400,
      delay: 600,
    });
  }

  // --- Score Alerts (Match Point / Deuce / Advantage) ---

  private checkScoreAlerts(p1Score: number, p2Score: number): void {
    let msg = '';
    let color = '#ff4444';
    let playSound = false;

    const deuceThreshold = WIN_SCORE - 1; // 10

    if (p1Score >= deuceThreshold && p2Score >= deuceThreshold) {
      if (p1Score === p2Score) {
        msg = 'DEUCE!';
        color = '#ffff00';
        playSound = true;
      } else {
        const leadingSide = p1Score > p2Score ? 'left' : 'right';
        const leaderName = leadingSide === 'left'
          ? (this.gameData.you.side === 'left' ? this.gameData.you.name : this.gameData.opponent.name)
          : (this.gameData.you.side === 'right' ? this.gameData.you.name : this.gameData.opponent.name);
        msg = `ADV ${leaderName.toUpperCase()}!`;
        color = leadingSide === 'left' ? '#00f5ff' : '#ff00e5';
        playSound = true;
      }
    } else if (p1Score === deuceThreshold && p2Score < deuceThreshold) {
      const p1Name = this.gameData.you.side === 'left' ? this.gameData.you.name : this.gameData.opponent.name;
      msg = `MATCH POINT ${p1Name.toUpperCase()}!`;
      color = '#00f5ff';
      playSound = true;
    } else if (p2Score === deuceThreshold && p1Score < deuceThreshold) {
      const p2Name = this.gameData.you.side === 'right' ? this.gameData.you.name : this.gameData.opponent.name;
      msg = `MATCH POINT ${p2Name.toUpperCase()}!`;
      color = '#ff00e5';
      playSound = true;
    }

    if (msg && msg !== this.lastAlertMsg) {
      this.lastAlertMsg = msg;
      this.alertText.setText(msg);
      this.alertText.setColor(color);
      this.alertText.setAlpha(1).setScale(1.5);

      this.tweens.killTweensOf(this.alertText);

      this.tweens.add({
        targets: this.alertText,
        scaleX: 1, scaleY: 1,
        duration: 300,
        ease: 'Back.easeOut',
      });

      this.tweens.add({
        targets: this.alertText,
        alpha: 0,
        duration: 500,
        delay: 1500,
      });

      if (playSound) {
        this.audio.matchPointAlert();
      }
    }
  }

  // --- Ripple Effects ---

  private addRipple(x: number, y: number, color: number): void {
    this.activeRipples.push({
      x, y,
      radius: 10,
      maxRadius: 60,
      color,
      startTime: Date.now(),
    });
  }

  private updateRipples(): void {
    if (this.activeRipples.length === 0) {
      this.rippleGraphics.clear();
      return;
    }

    this.rippleGraphics.clear();
    const expandSpeed = 120; // pixels per second
    const now = Date.now();

    this.activeRipples = this.activeRipples.filter(ripple => {
      const elapsed = (now - ripple.startTime) / 1000;
      ripple.radius = 10 + elapsed * expandSpeed;

      if (ripple.radius >= ripple.maxRadius) return false;

      const progress = (ripple.radius - 10) / (ripple.maxRadius - 10);
      const alpha = 0.4 * (1 - progress);

      this.rippleGraphics.lineStyle(2, ripple.color, alpha);
      this.rippleGraphics.strokeCircle(ripple.x, ripple.y, ripple.radius);
      return true;
    });
  }

  // --- Background Intensity ---

  private updateBgIntensity(speed: number): void {
    const speedFactor = Math.max((speed - 300) / 300, 0);
    const rallyFactor = Math.min(this.rallyCount / 10, 1);
    const streakFactor = Math.min(this.scoringStreak / 3, 1);
    const target = Math.min(speedFactor * 0.3 + rallyFactor * 0.2 + streakFactor * 0.1, 0.5);

    // Smooth lerp toward target
    this.bgIntensity += (target - this.bgIntensity) * 0.05;

    this.bgOverlay.clear();
    if (this.bgIntensity > 0.01) {
      const { arena } = this.gameData;
      const cx = arena.width / 2;
      const cy = arena.height / 2;

      // Warm pulse overlay
      this.bgOverlay.fillStyle(0x331111, this.bgIntensity * 0.3);
      this.bgOverlay.fillRect(0, 0, arena.width, arena.height);

      // Center glow
      for (let i = 3; i >= 1; i--) {
        this.bgOverlay.fillStyle(0x220000, this.bgIntensity * 0.05 * i);
        this.bgOverlay.fillCircle(cx, cy, 150 + i * 80);
      }
    }
  }

  // --- Speed Text Pop-ups ---

  private checkSpeedTier(speed: number, ballX: number, ballY: number): void {
    let currentTier = -1;
    for (let i = SPEED_TIERS.length - 1; i >= 0; i--) {
      if (speed >= SPEED_TIERS[i].speed) {
        currentTier = i;
        break;
      }
    }

    if (currentTier > this.lastSpeedTier && currentTier >= 0) {
      const tier = SPEED_TIERS[currentTier];
      this.showCommentary(ballX, ballY - 30, tier.text, tier.color);
      this.lastSpeedTier = currentTier;
    }
  }

  // --- Momentum Glow ---

  private drawMomentumGlow(): void {
    this.momentumGlow.clear();
    if (!this.lastScorerSide || this.scoringStreak < 1) return;

    const { arena } = this.gameData;
    const intensity = Math.min(this.scoringStreak * 0.04, 0.15);
    const color = this.lastScorerSide === 'left' ? P1_COLOR : P2_COLOR;

    if (this.lastScorerSide === 'left') {
      for (let i = 3; i >= 1; i--) {
        this.momentumGlow.fillStyle(color, intensity * (i / 3) * 0.4);
        this.momentumGlow.fillRect(0, 0, 15 * i, arena.height);
      }
    } else {
      for (let i = 3; i >= 1; i--) {
        this.momentumGlow.fillStyle(color, intensity * (i / 3) * 0.4);
        this.momentumGlow.fillRect(arena.width - 15 * i, 0, 15 * i, arena.height);
      }
    }
  }

  // --- Drawing Helpers ---

  private drawPaddle(gfx: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    gfx.clear();
    gfx.fillStyle(color);
    gfx.fillRoundedRect(x - 7.5, y - 50, 15, 100, 4);
  }

  private drawPaddleGlow(gfx: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    gfx.clear();
    gfx.fillStyle(color, 0.08);
    gfx.fillRoundedRect(x - 12, y - 55, 24, 110, 6);
    gfx.fillStyle(color, 0.04);
    gfx.fillRoundedRect(x - 16, y - 60, 32, 120, 8);
  }

  private drawBallGlow(x: number, y: number, color: number, radius: number = 8): void {
    this.ballGlow.clear();
    for (let i = 3; i >= 1; i--) {
      this.ballGlow.fillStyle(color, 0.06 * i);
      this.ballGlow.fillCircle(x, y, radius + i * 8);
    }
  }

  private drawCenterLine(alpha: number): void {
    const { arena } = this.gameData;
    this.centerLine.clear();
    this.centerLine.lineStyle(2, CENTER_LINE_COLOR, alpha);
    for (let y = 0; y < arena.height; y += 20) {
      this.centerLine.moveTo(arena.width / 2, y);
      this.centerLine.lineTo(arena.width / 2, y + 10);
    }
    this.centerLine.strokePath();
  }

  private updateTrail(state: GameStatePayload): void {
    this.trailPositions.push({ x: state.ball.x, y: state.ball.y });
    if (this.trailPositions.length > this.TRAIL_LENGTH) {
      this.trailPositions.shift();
    }

    const speed = Math.sqrt(state.ball.vx * state.ball.vx + state.ball.vy * state.ball.vy);
    const intensityMul = Math.min(speed / 600, 1);

    this.trailGraphics.clear();
    for (let i = 0; i < this.trailPositions.length - 1; i++) {
      const pos = this.trailPositions[i];
      const t = i / this.trailPositions.length;
      const alpha = t * 0.3 * intensityMul;
      const radius = 8 * t * intensityMul;
      if (radius > 0.5) {
        this.trailGraphics.fillStyle(this.ballColor, alpha);
        this.trailGraphics.fillCircle(pos.x, pos.y, radius);
      }
    }
  }

  // --- Ball Squash & Stretch ---

  private drawBallSquash(x: number, y: number, vx: number, vy: number, speed: number, radius: number): void {
    this.ballSquashGfx.clear();
    if (speed < 350) {
      this.ball.setVisible(true);
      return;
    }

    // Hide the Arc, draw stretched ellipse instead
    this.ball.setVisible(false);
    const stretch = 1 + Math.min((speed - 350) / 250, 0.6);
    const squish = 1 / Math.sqrt(stretch);
    const angle = Math.atan2(vy, vx);

    this.ballSquashGfx.fillStyle(this.ballColor);
    this.ballSquashGfx.save();
    this.ballSquashGfx.translateCanvas(x, y);
    this.ballSquashGfx.rotateCanvas(angle);
    this.ballSquashGfx.scaleCanvas(stretch, squish);
    this.ballSquashGfx.fillCircle(0, 0, radius);
    this.ballSquashGfx.restore();
  }

  // --- Paddle Squash & Stretch on Hit ---

  private drawPaddleSquashed(gfx: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    gfx.clear();
    gfx.fillStyle(color);
    // Wider but shorter
    gfx.fillRoundedRect(x - 10, y - 42, 20, 84, 6);
  }

  private drawPaddleStretched(gfx: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    gfx.clear();
    gfx.fillStyle(color);
    // Taller but thinner
    gfx.fillRoundedRect(x - 6, y - 54, 12, 108, 3);
  }

  // --- Paddle Trail ---

  private drawPaddleTrail(state: GameStatePayload): void {
    this.paddleTrailGfx.clear();
    const { arena } = this.gameData;

    // Left paddle trail
    const leftDelta = Math.abs(state.player1.paddleY - this.prevLeftPaddleY);
    if (leftDelta > 3) {
      const alpha = Math.min(leftDelta / 20, 0.3);
      this.paddleTrailGfx.fillStyle(P1_COLOR, alpha * 0.4);
      const minY = Math.min(state.player1.paddleY, this.prevLeftPaddleY);
      const maxY = Math.max(state.player1.paddleY, this.prevLeftPaddleY);
      this.paddleTrailGfx.fillRoundedRect(30 - 7.5, minY - 50, 15, maxY - minY + 100, 4);
    }

    // Right paddle trail
    const rightDelta = Math.abs(state.player2.paddleY - this.prevRightPaddleY);
    if (rightDelta > 3) {
      const alpha = Math.min(rightDelta / 20, 0.3);
      this.paddleTrailGfx.fillStyle(P2_COLOR, alpha * 0.4);
      const minY = Math.min(state.player2.paddleY, this.prevRightPaddleY);
      const maxY = Math.max(state.player2.paddleY, this.prevRightPaddleY);
      this.paddleTrailGfx.fillRoundedRect(arena.width - 30 - 7.5, minY - 50, 15, maxY - minY + 100, 4);
    }
  }

  // --- Lightning Sparks ---

  private drawLightning(state: GameStatePayload): void {
    const { arena } = this.gameData;
    const bx = state.ball.x;
    const by = state.ball.y;

    // Check proximity to left paddle
    const leftDist = Math.abs(bx - 30);
    if (leftDist < 80 && bx < arena.width / 2) {
      this.drawLightningArc(30, this.leftPaddleY, bx, by, P1_COLOR, 1 - leftDist / 80);
    }

    // Check proximity to right paddle
    const rightDist = Math.abs(bx - (arena.width - 30));
    if (rightDist < 80 && bx > arena.width / 2) {
      this.drawLightningArc(arena.width - 30, this.rightPaddleY, bx, by, P2_COLOR, 1 - rightDist / 80);
    }
  }

  private drawLightningArc(px: number, py: number, bx: number, by: number, color: number, intensity: number): void {
    const segments = 5;
    const alpha = intensity * 0.5;
    this.lightningGraphics.lineStyle(1.5, color, alpha);
    this.lightningGraphics.beginPath();
    this.lightningGraphics.moveTo(px, py);

    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const x = px + (bx - px) * t + (Math.random() - 0.5) * 20;
      const y = py + (by - py) * t + (Math.random() - 0.5) * 20;
      this.lightningGraphics.lineTo(x, y);
    }
    this.lightningGraphics.lineTo(bx, by);
    this.lightningGraphics.strokePath();

    // Second thinner arc for electricity feel
    if (intensity > 0.4) {
      this.lightningGraphics.lineStyle(1, 0xffffff, alpha * 0.5);
      this.lightningGraphics.beginPath();
      this.lightningGraphics.moveTo(px, py);
      for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const x = px + (bx - px) * t + (Math.random() - 0.5) * 15;
        const y = py + (by - py) * t + (Math.random() - 0.5) * 15;
        this.lightningGraphics.lineTo(x, y);
      }
      this.lightningGraphics.lineTo(bx, by);
      this.lightningGraphics.strokePath();
    }
  }

  // --- Streak Flames ---

  private updateStreakFlames(): void {
    if (this.scoringStreak >= 2 && this.lastScorerSide) {
      const { arena } = this.gameData;
      const isLeft = this.lastScorerSide === 'left';
      const px = isLeft ? 30 : arena.width - 30;
      const py = isLeft ? this.leftPaddleY : this.rightPaddleY;
      const angleBase = isLeft ? 180 : 0;

      this.flameEmitter.setPosition(px, py);
      this.flameEmitter.particleAngle = { min: angleBase - 30, max: angleBase + 30 };
      this.flameEmitter.emitting = true;
    } else {
      this.flameEmitter.emitting = false;
    }
  }

  // --- Arena Border Color Pulse ---

  private pulseArenaBorder(color: number): void {
    const { arena } = this.gameData;
    // Flash the border in the scoring player's color
    this.arenaBorder.clear();
    this.arenaBorder.lineStyle(3, color, 0.8);
    this.arenaBorder.strokeRect(0, 0, arena.width, arena.height);

    // Fade back to normal over 500ms
    this.tweens.addCounter({
      from: 0.8,
      to: this.borderBaseAlpha,
      duration: 500,
      onUpdate: (tween) => {
        this.arenaBorder.clear();
        const progress = 1 - (tween.getValue() as number - this.borderBaseAlpha) / (0.8 - this.borderBaseAlpha);
        const lineWidth = 3 - 2 * progress;
        // Lerp color back to purple
        const currentColor = progress > 0.7 ? CENTER_LINE_COLOR : color;
        this.arenaBorder.lineStyle(lineWidth, currentColor, tween.getValue() as number);
        this.arenaBorder.strokeRect(0, 0, arena.width, arena.height);
      },
    });
  }

  private getSpeedColor(vx: number, vy: number): number {
    const speed = Math.sqrt(vx * vx + vy * vy);
    const t = Math.min(Math.max((speed - 300) / 300, 0), 1);

    let r: number, g: number, b: number;
    if (t < 0.25) {
      const s = t / 0.25;
      r = 255; g = 255; b = Math.round(255 * (1 - s));
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      r = 255; g = Math.round(255 - 90 * s); b = 0;
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      r = 255; g = Math.round(165 - 165 * s); b = Math.round(180 * s);
    } else {
      const s = (t - 0.75) / 0.25;
      r = 255; g = 0; b = Math.round(180 * (1 - s));
    }
    return (r << 16) | (g << 8) | b;
  }

  // --- Game End ---

  private handleGameEnd(data: GameEndPayload): void {
    const socket = SocketManager.getInstance();
    socket.off('game_state', this.onGameState);
    socket.off('game_end', this.onGameEnd);

    this.scene.start('GameOverScene', {
      ...data,
      myId: socket.myId,
    });
  }

  shutdown(): void {
    const socket = SocketManager.getInstance();
    socket.off('game_state', this.onGameState);
    socket.off('game_end', this.onGameEnd);
    this.lastDirection = 0;
    this.prevState = null;
    this.lastCountdownNum = 0;
    this.trailPositions = [];
    this.rallyCount = 0;
    this.lastAlertMsg = '';
    this.activeRipples = [];
    this.bgIntensity = 0;
    this.lastSpeedTier = -1;
    this.lastScorerSide = null;
    this.scoringStreak = 0;
    this.prevLeftPaddleY = 0;
    this.prevRightPaddleY = 0;
    this.targetZoom = 1;
    this.slowMoFrames = 0;
    this.skipNextFrames = 0;
  }
}
