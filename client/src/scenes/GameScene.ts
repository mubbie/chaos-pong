import Phaser from 'phaser';
import { SocketManager } from '../network/socket';
import { SynthAudio } from '../audio/SynthAudio';
import type { GameStartPayload, GameStatePayload, GameEndPayload, PowerUpFieldState, TauntBroadcastPayload, SpectatorReactionBroadcast } from '../types/messages';
import { GameStatus, PowerUpType, POWERUP_NAMES, POWERUP_COLORS, TAUNT_EMOJIS, REACTION_EMOJIS } from '../types/messages';

// Callback set by main.ts to handle spectator leaving
export let onLeaveSpectate: (() => void) | null = null;
export function setOnLeaveSpectate(cb: () => void): void {
  onLeaveSpectate = cb;
}

// Callback set by main.ts to handle pause state changes from server
export let onPauseChanged: ((paused: boolean) => void) | null = null;
export function setOnPauseChanged(cb: (paused: boolean) => void): void {
  onPauseChanged = cb;
}

const COUNTDOWN_TICKS = 180; // 3 seconds * 60 ticks/sec

// Must match server constants for client-side prediction
const PADDLE_SPEED = 400; // pixels per second (same as backend PaddleSpeed)
const ARENA_HEIGHT = 600; // same as backend ArenaHeight

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
  private extraBallGfx!: Phaser.GameObjects.Graphics;
  private centerLine!: Phaser.GameObjects.Graphics;
  private p1NameText!: Phaser.GameObjects.Text;
  private p2NameText!: Phaser.GameObjects.Text;
  private p1ScoreText!: Phaser.GameObjects.Text;
  private p2ScoreText!: Phaser.GameObjects.Text;
  private dashText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;

  // State
  private sceneActive: boolean = false;
  private gameData!: GameStartPayload;
  private lastDirection: number = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wKey!: Phaser.Input.Keyboard.Key;
  private sKey!: Phaser.Input.Keyboard.Key;
  private tauntKeys: Phaser.Input.Keyboard.Key[] = [];

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
  // Dynamic score-to-win (from server or default 11)
  private winScore: number = 11;
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

  // Power-up rendering
  private powerUpGfx!: Phaser.GameObjects.Graphics;
  private powerUpLabel!: Phaser.GameObjects.Text;
  private shieldGfx!: Phaser.GameObjects.Graphics;
  private effectIndicatorGfx!: Phaser.GameObjects.Graphics;
  private frozenOverlayGfx!: Phaser.GameObjects.Graphics;
  private cannonGlowGfx!: Phaser.GameObjects.Graphics;
  private powerUpBobOffset: number = 0;
  private prevPowerUp: PowerUpFieldState | null = null;
  private prevActiveEffectTypes: Set<number> = new Set();
  private powerUpSpawnScale: number = 1;
  private powerUpSpawnRingRadius: number = 0;
  private powerUpSpawnRingAlpha: number = 0;
  private prevP1HasCannon: boolean = false;
  private prevP2HasCannon: boolean = false;
  private prevExtraBallCount: number = 0;
  private wasPaused: boolean = false;

  // Dynamic paddle heights (from server state)
  private leftPaddleHeight: number = 100;
  private rightPaddleHeight: number = 100;

  // Client-side prediction
  private predictedY: number = 0;     // local player's predicted paddle Y
  private myPaddleHeight: number = 100;
  private myFrozen: boolean = false;
  private myReversed: boolean = false;
  private lastFrameTime: number = 0;

  // Ball extrapolation between server ticks
  private ballVx: number = 0;
  private ballVy: number = 0;
  private ballServerX: number = 0;
  private ballServerY: number = 0;

  // Opponent paddle smoothing
  private opponentServerY: number = 0;
  private opponentDisplayY: number = 0;

  // Touch input (mobile)
  private touchActive: boolean = false;
  private touchTargetY: number = 0;

  // Bound callbacks
  private onGameState!: (payload: GameStatePayload) => void;
  private onGameEnd!: (payload: GameEndPayload) => void;
  private onTaunt!: (payload: TauntBroadcastPayload) => void;
  private onSpectatorReaction!: (payload: SpectatorReactionBroadcast) => void;

  // Spectator mode
  private isSpectator: boolean = false;
  private isTournament: boolean = false;
  private spectatorLabel!: Phaser.GameObjects.Text;
  private pausedLabel!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: GameStartPayload & { isTournament?: boolean }): void {
    this.gameData = data;
    this.isSpectator = data.isSpectator || false;
    this.isTournament = data.isTournament || false;
    this.winScore = data.scoreToWin ?? 11;
    const socket = SocketManager.getInstance();
    if (!this.isSpectator) {
      socket.setIdentity(data.you.id, data.you.name);
    }
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
    this.extraBallGfx = this.add.graphics().setDepth(8);
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
    this.predictedY = arena.height / 2;
    this.opponentServerY = arena.height / 2;
    this.opponentDisplayY = arena.height / 2;
    this.lastFrameTime = performance.now();
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

    // --- Power-up rendering layers ---
    this.shieldGfx = this.add.graphics().setDepth(4);
    this.powerUpGfx = this.add.graphics().setDepth(9);
    this.effectIndicatorGfx = this.add.graphics().setDepth(9);
    this.frozenOverlayGfx = this.add.graphics().setDepth(9);
    this.cannonGlowGfx = this.add.graphics().setDepth(4);
    this.powerUpLabel = this.add.text(0, 0, '', {
      fontSize: '12px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(9).setVisible(false);

    // --- Keyboard input ---
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.sKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);

    // --- Touch input (mobile) ---
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isSpectator) return;
      this.touchActive = true;
      this.touchTargetY = pointer.y;
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.touchActive || this.isSpectator) return;
      this.touchTargetY = pointer.y;
    });
    this.input.on('pointerup', () => {
      this.touchActive = false;
    });

    // Helper: check if pause menu is open (shared by taunt key handlers)
    const isPauseMenuOpen = () => {
      const overlay = document.getElementById('pause-menu');
      return overlay != null && !overlay.classList.contains('hidden');
    };

    if (!this.isSpectator) {
      // Taunt keys 1-6
      for (let i = 1; i <= 6; i++) {
        const key = this.input.keyboard!.addKey(48 + i); // KeyCodes for 1-6
        key.on('down', () => {
          if (isPauseMenuOpen()) return;
          SocketManager.getInstance().send('taunt', { tauntId: i });
        });
        this.tauntKeys.push(key);
      }
    } else {
      // Spectator: keys 1-6 send reactions instead of taunts
      for (let i = 1; i <= 6; i++) {
        const key = this.input.keyboard!.addKey(48 + i);
        key.on('down', () => {
          if (isPauseMenuOpen()) return;
          SocketManager.getInstance().send('spectator_reaction', { reactionId: i });
        });
        this.tauntKeys.push(key);
      }
    }

    // --- Scene is fully initialized —--
    this.sceneActive = true;

    // --- Subscribe to server messages ---
    const socket = SocketManager.getInstance();
    this.onGameState = (payload: GameStatePayload) => {
      if (!this.sceneActive) return;
      this.handleGameState(payload);
    };
    this.onGameEnd = (payload: GameEndPayload) => {
      if (!this.sceneActive) return;
      this.handleGameEnd(payload);
    };
    socket.on('game_state', this.onGameState);
    socket.on('game_end', this.onGameEnd);
    this.onTaunt = (payload: TauntBroadcastPayload) => {
      if (!this.sceneActive) return;
      this.handleTaunt(payload);
    };
    socket.on('taunt', this.onTaunt);
    this.onSpectatorReaction = (payload: SpectatorReactionBroadcast) => {
      if (!this.sceneActive) return;
      this.handleSpectatorReaction(payload);
    };
    socket.on('spectator_reaction', this.onSpectatorReaction);

    // Spectator-specific listeners
    if (this.isSpectator) {
      const onSpectatorInfo = (info: { player1Name: string; player2Name: string; p1Score: number; p2Score: number }) => {
        this.p1NameText.setText(info.player1Name);
        this.p2NameText.setText(info.player2Name);
        this.p1ScoreText.setText(info.p1Score.toString());
        this.p2ScoreText.setText(info.p2Score.toString());
      };
      socket.on('spectator_info', onSpectatorInfo);
      // Clean up
      this.events.on('shutdown', () => {
        socket.off('spectator_info', onSpectatorInfo);
      });
    }

    // Spectator overlay
    if (this.isSpectator) {
      this.spectatorLabel = this.add.text(arena.width / 2, 12, 'SPECTATING', {
        fontSize: '14px',
        color: '#ffffff',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      }).setOrigin(0.5, 0).setDepth(25).setAlpha(0.4);

      // "LEAVE" button in bottom-right
      const leaveBtn = this.add.text(arena.width - 10, arena.height - 10, '[LEAVE]', {
        fontSize: '12px',
        color: '#ff4444',
        fontFamily: 'monospace',
      }).setOrigin(1, 1).setDepth(25).setAlpha(0.6).setInteractive({ useHandCursor: true });
      leaveBtn.on('pointerover', () => leaveBtn.setAlpha(1));
      leaveBtn.on('pointerout', () => leaveBtn.setAlpha(0.6));
      leaveBtn.on('pointerdown', () => {
        SocketManager.getInstance().send('leave_spectate', {});
        const sock = SocketManager.getInstance();
        sock.off('game_state', this.onGameState);
        sock.off('game_end', this.onGameEnd);
        sock.off('taunt', this.onTaunt);
        sock.off('spectator_reaction', this.onSpectatorReaction);
        if (onLeaveSpectate) onLeaveSpectate();
      });
    }

    // Paused overlay label (hidden by default, shown when server says paused)
    this.pausedLabel = this.add.text(arena.width / 2, arena.height / 2 - 40, 'PAUSED', {
      fontSize: '36px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(30).setAlpha(0).setVisible(false);
  }

  update(): void {
    if (!this.sceneActive) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05); // cap at 50ms
    this.lastFrameTime = now;

    // Check if the game is paused (server-authoritative or local overlay for spectators)
    const pauseOverlay = document.getElementById('pause-menu');
    const overlayVisible = pauseOverlay != null && !pauseOverlay.classList.contains('hidden');
    const gamePaused = this.wasPaused || overlayVisible;

    if (!this.isSpectator) {
      if (gamePaused) {
        // Stop paddle movement while paused
        if (this.lastDirection !== 0) {
          this.lastDirection = 0;
          SocketManager.getInstance().send('player_input', { direction: 0 });
        }
      } else {
        const up = this.cursors.up.isDown || this.wKey.isDown;
        const down = this.cursors.down.isDown || this.sKey.isDown;

        let direction = 0;
        if (up && !down) direction = -1;
        else if (down && !up) direction = 1;

        // Touch input: derive direction from finger position vs paddle
        if (this.touchActive && direction === 0) {
          const deadzone = 8; // pixels of tolerance
          const diff = this.touchTargetY - this.predictedY;
          if (diff < -deadzone) direction = -1;
          else if (diff > deadzone) direction = 1;
        }

        if (direction !== this.lastDirection) {
          this.lastDirection = direction;
          SocketManager.getInstance().send('player_input', { direction });
        }

        // --- Client-side paddle prediction ---
        if (!this.myFrozen) {
          if (this.touchActive) {
            // Touch: move paddle directly toward finger Y (snappy response)
            let effectiveTarget = this.touchTargetY;
            if (this.myReversed) {
              effectiveTarget = ARENA_HEIGHT - this.touchTargetY;
            }
            const diff = effectiveTarget - this.predictedY;
            const maxMove = PADDLE_SPEED * dt;
            if (Math.abs(diff) <= maxMove) {
              this.predictedY = effectiveTarget;
            } else {
              this.predictedY += Math.sign(diff) * maxMove;
            }
          } else {
            // Keyboard: move at constant speed in direction
            let predictedDir = direction;
            if (this.myReversed) predictedDir = -predictedDir;
            this.predictedY += predictedDir * PADDLE_SPEED * dt;
          }

          // Clamp to arena bounds (matching server logic)
          const halfH = this.myPaddleHeight / 2;
          if (this.predictedY - halfH < 0) this.predictedY = halfH;
          if (this.predictedY + halfH > ARENA_HEIGHT) this.predictedY = ARENA_HEIGHT - halfH;
        }

        // Apply predicted position to the local paddle and redraw
        const { arena } = this.gameData;
        const isLeft = this.gameData.you.side === 'left';
        if (isLeft) {
          this.leftPaddleY = this.predictedY;
          this.drawPaddle(this.leftPaddleGfx, 30, this.leftPaddleY, P1_COLOR, this.leftPaddleHeight);
          this.drawPaddleGlow(this.leftPaddleGlow, 30, this.leftPaddleY, P1_COLOR, this.leftPaddleHeight);
        } else {
          this.rightPaddleY = this.predictedY;
          this.drawPaddle(this.rightPaddleGfx, arena.width - 30, this.rightPaddleY, P2_COLOR, this.rightPaddleHeight);
          this.drawPaddleGlow(this.rightPaddleGlow, arena.width - 30, this.rightPaddleY, P2_COLOR, this.rightPaddleHeight);
        }
      }
    }

    // --- Ball extrapolation between server ticks ---
    if (!gamePaused && this.ballVx !== 0 || this.ballVy !== 0) {
      let bx = this.ball.x + this.ballVx * dt;
      let by = this.ball.y + this.ballVy * dt;

      // Bounce off top/bottom walls (like server does)
      if (by < 0) { by = -by; }
      if (by > ARENA_HEIGHT) { by = 2 * ARENA_HEIGHT - by; }

      this.ball.setPosition(bx, by);
    }

    // --- Opponent paddle smoothing ---
    if (this.prevState) {
      const diff = this.opponentServerY - this.opponentDisplayY;
      if (Math.abs(diff) > 1) {
        this.opponentDisplayY += diff * 0.35;
        const { arena } = this.gameData;
        const isLeft = !this.isSpectator && this.gameData.you.side === 'left';
        if (isLeft) {
          this.rightPaddleY = this.opponentDisplayY;
          this.drawPaddle(this.rightPaddleGfx, arena.width - 30, this.rightPaddleY, P2_COLOR, this.rightPaddleHeight);
          this.drawPaddleGlow(this.rightPaddleGlow, arena.width - 30, this.rightPaddleY, P2_COLOR, this.rightPaddleHeight);
        } else if (!this.isSpectator) {
          this.leftPaddleY = this.opponentDisplayY;
          this.drawPaddle(this.leftPaddleGfx, 30, this.leftPaddleY, P1_COLOR, this.leftPaddleHeight);
          this.drawPaddleGlow(this.leftPaddleGlow, 30, this.leftPaddleY, P1_COLOR, this.leftPaddleHeight);
        }
      }
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
    let shieldHit = false;
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
          // Ball's horizontal velocity flipped — could be a paddle hit or a shield bounce.
          // Distinguish by checking if an active shield is on the bounce side
          // and if the ball is closer to the shield than to the paddle.
          if (state.shield?.active) {
            const hitLeft = state.ball.vx > 0; // bounced on left side
            const shieldOnSameSide = (hitLeft && state.shield.side === 0) ||
                                     (!hitLeft && state.shield.side === 1);
            if (shieldOnSameSide) {
              const paddleX = hitLeft ? 30 : arena.width - 30;
              const distToShield = Math.abs(state.ball.x - state.shield.x);
              const distToPaddle = Math.abs(state.ball.x - paddleX);
              if (distToShield < distToPaddle) {
                shieldHit = true;
              } else {
                paddleHit = true;
              }
            } else {
              paddleHit = true;
            }
          } else {
            paddleHit = true;
          }
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

    // Prefer server-authoritative paddleHit flag when available
    if (state.paddleHit) {
      paddleHit = true;
    }

    // --- Position Updates (with client-side prediction reconciliation) ---
    this.leftPaddleHeight = state.player1.paddleHeight || 100;
    this.rightPaddleHeight = state.player2.paddleHeight || 100;

    const isLeft = !this.isSpectator && this.gameData.you.side === 'left';
    const isRight = !this.isSpectator && this.gameData.you.side === 'right';

    // Sync prediction state from server effects
    if (isLeft) {
      this.myFrozen = state.player1Effects?.frozen ?? false;
      this.myReversed = state.player1Effects?.reversed ?? false;
      this.myPaddleHeight = this.leftPaddleHeight;
    } else if (isRight) {
      this.myFrozen = state.player2Effects?.frozen ?? false;
      this.myReversed = state.player2Effects?.reversed ?? false;
      this.myPaddleHeight = this.rightPaddleHeight;
    }

    // Reconcile local prediction with server authority
    if (isLeft) {
      const serverY = state.player1.paddleY;
      const error = Math.abs(this.predictedY - serverY);
      // Snap if error is large (e.g. teleport/reset), otherwise nudge toward server
      if (error > 30) {
        this.predictedY = serverY;
      } else if (error > 1) {
        this.predictedY += (serverY - this.predictedY) * 0.3;
      }
      this.leftPaddleY = this.predictedY;
      // Opponent paddle: set target for smoothing in update()
      this.opponentServerY = state.player2.paddleY;
      if (Math.abs(this.opponentServerY - this.opponentDisplayY) > 50) {
        this.opponentDisplayY = this.opponentServerY; // snap on large jump
      }
      this.rightPaddleY = this.opponentDisplayY;
    } else if (isRight) {
      const serverY = state.player2.paddleY;
      const error = Math.abs(this.predictedY - serverY);
      if (error > 30) {
        this.predictedY = serverY;
      } else if (error > 1) {
        this.predictedY += (serverY - this.predictedY) * 0.3;
      }
      this.rightPaddleY = this.predictedY;
      // Opponent paddle: set target for smoothing in update()
      this.opponentServerY = state.player1.paddleY;
      if (Math.abs(this.opponentServerY - this.opponentDisplayY) > 50) {
        this.opponentDisplayY = this.opponentServerY;
      }
      this.leftPaddleY = this.opponentDisplayY;
    } else {
      // Spectator: both paddles from server
      this.leftPaddleY = state.player1.paddleY;
      this.rightPaddleY = state.player2.paddleY;
    }

    // --- Ball: snap to server position and store velocity for extrapolation ---
    this.ballVx = state.ball.vx;
    this.ballVy = state.ball.vy;
    this.ballServerX = state.ball.x;
    this.ballServerY = state.ball.y;
    this.ball.setPosition(state.ball.x, state.ball.y);

    this.drawPaddle(this.leftPaddleGfx, 30, this.leftPaddleY, P1_COLOR, this.leftPaddleHeight);
    this.drawPaddle(this.rightPaddleGfx, arena.width - 30, this.rightPaddleY, P2_COLOR, this.rightPaddleHeight);

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
    this.drawPaddleGlow(this.leftPaddleGlow, 30, this.leftPaddleY, P1_COLOR, this.leftPaddleHeight);
    this.drawPaddleGlow(this.rightPaddleGlow, arena.width - 30, this.rightPaddleY, P2_COLOR, this.rightPaddleHeight);

    // --- Momentum Glow ---
    this.drawMomentumGlow();

    // --- Rally Tracking (prefer server-authoritative count) ---
    if (state.rallyCount !== undefined) {
      const prevRally = this.rallyCount;
      this.rallyCount = state.rallyCount;
      if (this.rallyCount >= 3 && this.rallyCount > prevRally) {
        this.showRally();
      }
    } else {
      // Fallback to client-side tracking
      if (paddleHit) {
        this.rallyCount++;
        if (this.rallyCount >= 3) {
          this.showRally();
        }
      }
      if (scored) {
        this.rallyCount = 0;
      }
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
      const hitPaddleH = hitLeft ? this.leftPaddleHeight : this.rightPaddleHeight;
      this.drawPaddleSquashed(hitGfx, hitX, hitY, 0xffffff, hitPaddleH);
      this.time.delayedCall(50, () => {
        this.drawPaddleStretched(hitGfx, hitX, hitY, hitColor, hitPaddleH);
      });
      this.time.delayedCall(120, () => {
        this.drawPaddle(hitGfx, hitX, hitY, hitColor, hitPaddleH);
      });

      // Particles
      this.paddleHitEmitter.setPosition(hitX, state.ball.y);
      this.paddleHitEmitter.setParticleTint(hitColor);
      this.paddleHitEmitter.explode(12);

      // Screen shake escalates with rally
      const shakeIntensity = Math.min(0.003 + this.rallyCount * 0.001, 0.015);
      this.cameras.main.shake(100, shakeIntensity);

      // Hit stop: brief visual freeze on high-speed hits for dramatic impact
      if (speed >= 450) {
        this.skipNextFrames = Math.min(2 + Math.floor((speed - 450) / 75), 4);
      }

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

      this.audio.paddleHit(state.rallyCount ?? this.rallyCount);
    }

    // --- Shield Bounce Effects ---
    if (shieldHit && state.shield) {
      this.paddleHitEmitter.setPosition(state.ball.x, state.ball.y);
      this.paddleHitEmitter.setParticleTint(0xffd700); // gold particles
      this.paddleHitEmitter.explode(10);
      this.addRipple(state.ball.x, state.ball.y, 0xffd700);
      this.audio.shieldBlock();
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

    // --- Ghost Ball ---
    if (state.ballInvisible) {
      this.ball.setAlpha(0.08);
      this.ballGlow.setAlpha(0.05);
      this.trailGraphics.setAlpha(0.05);
      this.ballSquashGfx.setAlpha(0.08);
    } else {
      this.ball.setAlpha(1);
      this.ballGlow.setAlpha(1);
      this.trailGraphics.setAlpha(1);
      this.ballSquashGfx.setAlpha(1);
    }

    // --- Shield Rendering ---
    this.shieldGfx.clear();
    if (state.shield?.active) {
      const sx = state.shield.x - state.shield.width / 2;
      const sy = state.shield.y - state.shield.height / 2;
      const sw = state.shield.width;
      const sh = state.shield.height;

      // Outer glow
      this.shieldGfx.fillStyle(0xffd700, 0.12);
      this.shieldGfx.fillRect(sx - 6, sy - 6, sw + 12, sh + 12);
      // Inner glow
      this.shieldGfx.fillStyle(0xffd700, 0.25);
      this.shieldGfx.fillRect(sx - 3, sy - 3, sw + 6, sh + 6);
      // Shield bar
      this.shieldGfx.fillStyle(0xffd700, 0.7);
      this.shieldGfx.fillRect(sx, sy, sw, sh);
    }

    // --- Extra Balls ---
    this.extraBallGfx.clear();
    if (state.extraBalls && state.extraBalls.length > 0) {
      for (const eb of state.extraBalls) {
        // Glow
        this.extraBallGfx.fillStyle(0xff6600, 0.15);
        this.extraBallGfx.fillCircle(eb.x, eb.y, eb.size * 1.5);
        // Ball
        this.extraBallGfx.fillStyle(0xff4400, 1);
        this.extraBallGfx.fillCircle(eb.x, eb.y, eb.size / 2);
        // Core highlight
        this.extraBallGfx.fillStyle(0xff8800, 0.7);
        this.extraBallGfx.fillCircle(eb.x - 2, eb.y - 2, eb.size / 4);
      }

      // Detect multi-ball activation
      if (this.prevExtraBallCount === 0) {
        this.audio.multiBallSplit();
        this.showCommentary(arena.width / 2, arena.height / 2 - 60, 'MULTI-BALL!', '#ff6600');
      }
    }
    this.prevExtraBallCount = state.extraBalls?.length ?? 0;

    // --- Power-Up Field Rendering ---
    this.renderFieldPowerUp(state);

    // --- Power-Up Spawn Detection ---
    const hadPowerUp = this.prevPowerUp != null;
    const hasPowerUp = state.powerUp != null;
    if (!hadPowerUp && hasPowerUp) {
      // Power-up just spawned! Scale-in animation + sound
      this.powerUpSpawnScale = 0;
      this.powerUpSpawnRingRadius = 0;
      this.powerUpSpawnRingAlpha = 0.5;
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 400,
        ease: 'Back.easeOut',
        onUpdate: (tween) => {
          this.powerUpSpawnScale = tween.getValue() as number;
        },
      });
      // Expanding ring effect
      this.tweens.addCounter({
        from: 0,
        to: 50,
        duration: 600,
        ease: 'Power2',
        onUpdate: (tween) => {
          this.powerUpSpawnRingRadius = tween.getValue() as number;
          this.powerUpSpawnRingAlpha = 0.5 * (1 - (tween.getValue() as number) / 50);
        },
        onComplete: () => {
          this.powerUpSpawnRingAlpha = 0;
        },
      });
      // Spawn particles
      const pu = state.powerUp!;
      const spawnColor = POWERUP_COLORS[pu.type] ?? 0xffffff;
      this.paddleHitEmitter.setPosition(pu.x, pu.y);
      this.paddleHitEmitter.setParticleTint(spawnColor);
      this.paddleHitEmitter.explode(10);

      this.audio.powerUpSpawn();
    }

    // --- Power-Up Collection Detection ---
    if (hadPowerUp && !hasPowerUp) {
      // Power-up was collected!
      const pu = this.prevPowerUp!;
      const puColor = POWERUP_COLORS[pu.type] ?? 0xffffff;
      const puName = POWERUP_NAMES[pu.type] ?? 'POWER UP';

      // Particle burst at collection point
      this.paddleHitEmitter.setPosition(pu.x, pu.y);
      this.paddleHitEmitter.setParticleTint(puColor);
      this.paddleHitEmitter.explode(20);

      // Commentary
      this.showCommentary(pu.x, pu.y - 30, puName + '!', '#' + puColor.toString(16).padStart(6, '0'));

      // Sound
      this.audio.powerUpCollect();
    }
    this.prevPowerUp = state.powerUp ? { ...state.powerUp } : null;

    // --- Effect New Detection (for one-shot sounds/effects) ---
    const currentEffectTypes = new Set((state.activeEffects ?? []).map(e => e.type));
    for (const effectType of currentEffectTypes) {
      if (!this.prevActiveEffectTypes.has(effectType)) {
        // New effect just started
        if (effectType === PowerUpType.Freeze) this.audio.freezeSound();
        if (effectType === PowerUpType.GhostBall) this.audio.ghostBallSound();
      }
    }
    this.prevActiveEffectTypes = currentEffectTypes;

    // --- Cannon Fire Detection ---
    const p1Cannon = state.player1Effects?.hasCannon ?? false;
    const p2Cannon = state.player2Effects?.hasCannon ?? false;
    if (this.prevP1HasCannon && !p1Cannon) this.audio.cannonFire();
    if (this.prevP2HasCannon && !p2Cannon) this.audio.cannonFire();
    this.prevP1HasCannon = p1Cannon;
    this.prevP2HasCannon = p2Cannon;

    // --- Effect Indicators ---
    this.renderEffectIndicators(state);

    // --- Pause Detection ---
    const nowPaused = state.paused ?? false;
    if (nowPaused !== this.wasPaused) {
      this.wasPaused = nowPaused;
      // Show/hide "PAUSED" label for everyone (players + spectators)
      if (nowPaused) {
        this.pausedLabel.setVisible(true).setAlpha(0.6);
      } else {
        this.pausedLabel.setVisible(false).setAlpha(0);
      }
      // Notify main.ts for player pause menu (not for spectators — they have local-only menu)
      if (!this.isSpectator && onPauseChanged) {
        onPauseChanged(nowPaused);
      }
    }

    // --- Save State ---
    this.prevState = {
      ...state,
      ball: { ...state.ball },
      player1: { ...state.player1 },
      player2: { ...state.player2 },
    };
  }

  // --- Taunts ---

  private handleTaunt(data: TauntBroadcastPayload): void {
    const emoji = TAUNT_EMOJIS[data.tauntId];
    if (!emoji) return;

    const arena = this.gameData.arena;
    // Determine which side the taunter is on
    let taunterSide: 'left' | 'right';
    if (this.isSpectator && this.prevState) {
      // For spectators, use actual player IDs from game state
      // Player1 is always left, Player2 is always right
      taunterSide = data.playerId === this.prevState.player1.id ? 'left' : 'right';
    } else if (data.playerId === this.gameData.you.id) {
      taunterSide = this.gameData.you.side;
    } else {
      taunterSide = this.gameData.opponent.side;
    }

    // Show emoji near taunter's paddle
    const x = taunterSide === 'left' ? 60 : arena.width - 60;
    const y = arena.height / 2 - 20;

    const txt = this.add.text(x, y, emoji, {
      fontSize: '32px',
      fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(20).setAlpha(1);

    this.tweens.add({
      targets: txt,
      y: y - 50,
      alpha: 0,
      duration: 1500,
      ease: 'Power2',
      onComplete: () => txt.destroy(),
    });

    this.audio.tauntBlip();
  }

  // --- Spectator Reactions ---

  private handleSpectatorReaction(data: SpectatorReactionBroadcast): void {
    const emoji = REACTION_EMOJIS[data.reactionId];
    if (!emoji) return;

    const { arena } = this.gameData;

    // Emoji rain from top: 5-8 copies falling from random X positions
    const count = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const x = 50 + Math.random() * (arena.width - 100);
      const startY = -20 - Math.random() * 40;
      const delay = Math.random() * 300;

      const txt = this.add.text(x, startY, emoji, {
        fontSize: '24px',
        fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(22).setAlpha(0.8);

      this.tweens.add({
        targets: txt,
        y: arena.height + 30,
        alpha: 0,
        duration: 2000 + Math.random() * 1000,
        delay,
        ease: 'Sine.easeIn',
        onComplete: () => txt.destroy(),
      });
    }

    this.audio.tauntBlip();
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

    const deuceThreshold = this.winScore - 1;

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
    const target = Math.min(speedFactor * 0.3 + rallyFactor * 0.2 + streakFactor * 0.1, 0.35);

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

  private drawPaddle(gfx: Phaser.GameObjects.Graphics, x: number, y: number, color: number, height: number = 100): void {
    gfx.clear();
    gfx.fillStyle(color);
    gfx.fillRoundedRect(x - 7.5, y - height / 2, 15, height, 4);
  }

  private drawPaddleGlow(gfx: Phaser.GameObjects.Graphics, x: number, y: number, color: number, height: number = 100): void {
    gfx.clear();
    // Bright edge outline so paddle is always visible during chaos
    gfx.lineStyle(1.5, color, 0.5);
    gfx.strokeRoundedRect(x - 8.5, y - height / 2 - 1, 17, height + 2, 5);
    // Inner glow
    gfx.fillStyle(color, 0.15);
    gfx.fillRoundedRect(x - 12, y - height / 2 - 5, 24, height + 10, 6);
    // Outer glow
    gfx.fillStyle(color, 0.08);
    gfx.fillRoundedRect(x - 18, y - height / 2 - 10, 36, height + 20, 8);
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

  private drawPaddleSquashed(gfx: Phaser.GameObjects.Graphics, x: number, y: number, color: number, height: number = 100): void {
    gfx.clear();
    gfx.fillStyle(color);
    // Wider but shorter
    const squashedH = height * 0.84;
    gfx.fillRoundedRect(x - 10, y - squashedH / 2, 20, squashedH, 6);
  }

  private drawPaddleStretched(gfx: Phaser.GameObjects.Graphics, x: number, y: number, color: number, height: number = 100): void {
    gfx.clear();
    gfx.fillStyle(color);
    // Taller but thinner
    const stretchedH = height * 1.08;
    gfx.fillRoundedRect(x - 6, y - stretchedH / 2, 12, stretchedH, 3);
  }

  // --- Paddle Trail ---

  private drawPaddleTrail(state: GameStatePayload): void {
    this.paddleTrailGfx.clear();
    const { arena } = this.gameData;
    const p1H = this.leftPaddleHeight;
    const p2H = this.rightPaddleHeight;

    // Left paddle trail
    const leftDelta = Math.abs(state.player1.paddleY - this.prevLeftPaddleY);
    if (leftDelta > 3) {
      const alpha = Math.min(leftDelta / 20, 0.3);
      this.paddleTrailGfx.fillStyle(P1_COLOR, alpha * 0.4);
      const minY = Math.min(state.player1.paddleY, this.prevLeftPaddleY);
      const maxY = Math.max(state.player1.paddleY, this.prevLeftPaddleY);
      this.paddleTrailGfx.fillRoundedRect(30 - 7.5, minY - p1H / 2, 15, maxY - minY + p1H, 4);
    }

    // Right paddle trail
    const rightDelta = Math.abs(state.player2.paddleY - this.prevRightPaddleY);
    if (rightDelta > 3) {
      const alpha = Math.min(rightDelta / 20, 0.3);
      this.paddleTrailGfx.fillStyle(P2_COLOR, alpha * 0.4);
      const minY = Math.min(state.player2.paddleY, this.prevRightPaddleY);
      const maxY = Math.max(state.player2.paddleY, this.prevRightPaddleY);
      this.paddleTrailGfx.fillRoundedRect(arena.width - 30 - 7.5, minY - p2H / 2, 15, maxY - minY + p2H, 4);
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

  // --- Power-Up Field Rendering ---

  private renderFieldPowerUp(state: GameStatePayload): void {
    this.powerUpGfx.clear();

    if (!state.powerUp) {
      this.powerUpLabel.setVisible(false);
      return;
    }

    const pu = state.powerUp;
    const puColor = POWERUP_COLORS[pu.type] ?? 0xffffff;
    const puName = POWERUP_NAMES[pu.type] ?? '?';
    const scale = this.powerUpSpawnScale;

    // Floating bob animation
    this.powerUpBobOffset += 0.05;
    const bobY = pu.y + Math.sin(this.powerUpBobOffset) * 4;

    // Spawn ring (expanding outward on spawn)
    if (this.powerUpSpawnRingAlpha > 0.01) {
      this.powerUpGfx.lineStyle(2, puColor, this.powerUpSpawnRingAlpha);
      this.powerUpGfx.strokeCircle(pu.x, bobY, this.powerUpSpawnRingRadius);
    }

    // Pulsing glow ring (scaled) — extra-large orb for easy pickup
    const pulseAlpha = 0.15 + Math.sin(this.powerUpBobOffset * 1.5) * 0.1;
    this.powerUpGfx.fillStyle(puColor, pulseAlpha * 0.2 * scale);
    this.powerUpGfx.fillCircle(pu.x, bobY, 60 * scale);
    this.powerUpGfx.fillStyle(puColor, pulseAlpha * 0.4 * scale);
    this.powerUpGfx.fillCircle(pu.x, bobY, 48 * scale);
    this.powerUpGfx.fillStyle(puColor, pulseAlpha * scale);
    this.powerUpGfx.fillCircle(pu.x, bobY, 36 * scale);

    // Inner icon shape (scaled using canvas transform) — 2x icon size
    if (scale > 0.1) {
      this.powerUpGfx.save();
      this.powerUpGfx.translateCanvas(pu.x, bobY);
      this.powerUpGfx.scaleCanvas(scale * 2, scale * 2);
      this.powerUpGfx.translateCanvas(-pu.x, -bobY);
      this.powerUpGfx.fillStyle(puColor, 0.85);
      this.drawPowerUpIcon(pu.x, bobY, pu.type);
      this.powerUpGfx.restore();
    }

    // Label (fades in with scale)
    this.powerUpLabel.setPosition(pu.x, bobY + 46);
    this.powerUpLabel.setText(puName);
    this.powerUpLabel.setColor('#' + puColor.toString(16).padStart(6, '0'));
    this.powerUpLabel.setAlpha(scale);
    this.powerUpLabel.setVisible(true);
  }

  private drawPowerUpIcon(x: number, y: number, type: number): void {
    const color = POWERUP_COLORS[type] ?? 0xffffff;
    this.powerUpGfx.fillStyle(color, 0.9);

    switch (type) {
      case PowerUpType.BigPaddle:
        // Upward arrow
        this.powerUpGfx.fillRect(x - 2, y - 8, 4, 16);
        this.powerUpGfx.fillTriangle(x - 6, y - 4, x + 6, y - 4, x, y - 12);
        break;
      case PowerUpType.Shrink:
        // Downward arrow
        this.powerUpGfx.fillRect(x - 2, y - 8, 4, 16);
        this.powerUpGfx.fillTriangle(x - 6, y + 4, x + 6, y + 4, x, y + 12);
        break;
      case PowerUpType.SpeedBoost:
        // Double chevrons >>
        this.powerUpGfx.fillTriangle(x - 6, y - 6, x - 6, y + 6, x, y);
        this.powerUpGfx.fillTriangle(x, y - 6, x, y + 6, x + 6, y);
        break;
      case PowerUpType.CannonShot:
        // Circle (cannonball)
        this.powerUpGfx.fillCircle(x, y, 7);
        break;
      case PowerUpType.Freeze:
        // Snowflake pattern (6 lines)
        this.powerUpGfx.lineStyle(2, color, 0.9);
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2;
          this.powerUpGfx.lineBetween(x, y, x + Math.cos(angle) * 9, y + Math.sin(angle) * 9);
        }
        break;
      case PowerUpType.ReverseControls:
        // Two arrows (up/down swapped)
        this.powerUpGfx.fillTriangle(x - 4, y + 2, x + 4, y + 2, x, y - 8);
        this.powerUpGfx.fillTriangle(x - 4, y - 2, x + 4, y - 2, x, y + 8);
        break;
      case PowerUpType.GhostBall:
        // Dashed circle (drawn as dotted ring)
        this.powerUpGfx.lineStyle(2, color, 0.5);
        this.powerUpGfx.strokeCircle(x, y, 8);
        break;
      case PowerUpType.Shield:
        // Shield icon (thick bar)
        this.powerUpGfx.fillRect(x - 3, y - 10, 6, 20);
        this.powerUpGfx.lineStyle(2, color, 0.9);
        this.powerUpGfx.strokeRect(x - 5, y - 12, 10, 24);
        break;
      default:
        this.powerUpGfx.fillCircle(x, y, 8);
    }
  }

  // --- Effect Indicators ---

  private renderEffectIndicators(state: GameStatePayload): void {
    this.effectIndicatorGfx.clear();
    this.frozenOverlayGfx.clear();
    this.cannonGlowGfx.clear();

    const { arena } = this.gameData;
    const p1Effects = state.player1Effects;
    const p2Effects = state.player2Effects;

    // Frozen overlay on paddle
    if (p1Effects?.frozen) {
      this.drawFrozenOverlay(30, this.leftPaddleY, this.leftPaddleHeight);
    }
    if (p2Effects?.frozen) {
      this.drawFrozenOverlay(arena.width - 30, this.rightPaddleY, this.rightPaddleHeight);
    }

    // Reversed controls indicator text
    if (p1Effects?.reversed) {
      this.drawReversedIndicator(30, this.leftPaddleY, this.leftPaddleHeight);
    }
    if (p2Effects?.reversed) {
      this.drawReversedIndicator(arena.width - 30, this.rightPaddleY, this.rightPaddleHeight);
    }

    // Cannon armed glow
    if (p1Effects?.hasCannon) {
      this.drawCannonGlow(30, this.leftPaddleY, P1_COLOR, this.leftPaddleHeight);
    }
    if (p2Effects?.hasCannon) {
      this.drawCannonGlow(arena.width - 30, this.rightPaddleY, P2_COLOR, this.rightPaddleHeight);
    }

    // Size change glow indicators
    if (p1Effects && p1Effects.paddleHeight > 100) {
      this.drawSizeGlow(30, this.leftPaddleY, this.leftPaddleHeight, 0x22c55e); // green for big
    }
    if (p2Effects && p2Effects.paddleHeight > 100) {
      this.drawSizeGlow(arena.width - 30, this.rightPaddleY, this.rightPaddleHeight, 0x22c55e);
    }
    if (p1Effects && p1Effects.paddleHeight < 100 && p1Effects.paddleHeight > 0) {
      this.drawSizeGlow(30, this.leftPaddleY, this.leftPaddleHeight, 0xff8800); // orange for shrunk
    }
    if (p2Effects && p2Effects.paddleHeight < 100 && p2Effects.paddleHeight > 0) {
      this.drawSizeGlow(arena.width - 30, this.rightPaddleY, this.rightPaddleHeight, 0xff8800);
    }
  }

  private drawFrozenOverlay(x: number, y: number, height: number): void {
    // Ice crystal overlay
    this.frozenOverlayGfx.fillStyle(0x88ccff, 0.25);
    this.frozenOverlayGfx.fillRoundedRect(x - 10, y - height / 2 - 3, 20, height + 6, 5);

    // Sparkle particles
    for (let i = 0; i < 4; i++) {
      const sparkX = x - 8 + Math.random() * 16;
      const sparkY = y - height / 2 + Math.random() * height;
      this.frozenOverlayGfx.fillStyle(0xffffff, 0.6);
      this.frozenOverlayGfx.fillCircle(sparkX, sparkY, 1.5);
    }
  }

  private drawReversedIndicator(x: number, y: number, height: number): void {
    // Purple tint on paddle
    this.effectIndicatorGfx.fillStyle(0xaa44ff, 0.15);
    this.effectIndicatorGfx.fillRoundedRect(x - 10, y - height / 2 - 3, 20, height + 6, 5);
  }

  private drawCannonGlow(x: number, y: number, baseColor: number, height: number): void {
    // Pulsing red glow behind paddle
    const pulse = 0.15 + Math.sin(Date.now() / 150) * 0.1;
    this.cannonGlowGfx.fillStyle(0xff0044, pulse);
    this.cannonGlowGfx.fillRoundedRect(x - 14, y - height / 2 - 8, 28, height + 16, 8);
    this.cannonGlowGfx.fillStyle(0xff0044, pulse * 0.5);
    this.cannonGlowGfx.fillRoundedRect(x - 18, y - height / 2 - 12, 36, height + 24, 10);
  }

  private drawSizeGlow(x: number, y: number, height: number, color: number): void {
    this.effectIndicatorGfx.fillStyle(color, 0.1);
    this.effectIndicatorGfx.fillRoundedRect(x - 14, y - height / 2 - 5, 28, height + 10, 6);
  }

  // --- Game End ---

  private handleGameEnd(data: GameEndPayload): void {
    this.sceneActive = false;
    const socket = SocketManager.getInstance();
    socket.off('game_state', this.onGameState);
    socket.off('game_end', this.onGameEnd);
    socket.off('taunt', this.onTaunt);
    socket.off('spectator_reaction', this.onSpectatorReaction);

    if (this.isTournament) {
      // Tournament players + tournament spectators: main.ts handles cleanup via bracket
      if (onLeaveSpectate) onLeaveSpectate();
      return;
    }

    const sceneData = {
      ...data,
      myId: socket.myId,
      you: this.gameData.you,
      opponent: this.gameData.opponent,
    };

    if (data.isForfeit) {
      // Show in-game forfeit overlay before transitioning to game-over screen
      this.showForfeitOverlay();
      this.time.delayedCall(2000, () => {
        this.scene.start('GameOverScene', sceneData);
      });
      return;
    }

    // Normal game end — transition immediately
    this.scene.start('GameOverScene', sceneData);
  }

  /** Dark overlay with "OPPONENT LEFT" shown for 2s before game-over screen */
  private showForfeitOverlay(): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const cx = w / 2;
    const cy = h / 2;

    // Darken the game
    const bg = this.add.rectangle(cx, cy, w, h, 0x000000, 0.7).setDepth(200);
    bg.setAlpha(0);

    // Main text
    const heading = this.add.text(cx, cy - 20, 'OPPONENT LEFT', {
      fontSize: '36px',
      color: '#ef4444',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(201).setAlpha(0);

    // Subtitle
    const subtitle = this.add.text(cx, cy + 25, 'You win by forfeit', {
      fontSize: '16px',
      color: '#888888',
      fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(201).setAlpha(0);

    // Animate in
    this.tweens.add({ targets: bg, alpha: 1, duration: 300 });
    this.tweens.add({
      targets: heading,
      alpha: 1,
      duration: 400,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: subtitle,
      alpha: 1,
      duration: 300,
      delay: 200,
    });
  }

  shutdown(): void {
    this.sceneActive = false;
    const socket = SocketManager.getInstance();
    socket.off('game_state', this.onGameState);
    socket.off('game_end', this.onGameEnd);
    socket.off('taunt', this.onTaunt);
    socket.off('spectator_reaction', this.onSpectatorReaction);

    // Clean up taunt key event listeners to prevent leaks
    for (const key of this.tauntKeys) {
      key.removeAllListeners('down');
    }
    this.tauntKeys = [];

    // Clean up SynthAudio instance to prevent accumulation in static Set
    if (this.audio) {
      this.audio.destroy();
    }

    this.isSpectator = false;
    this.isTournament = false;
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
    this.prevPowerUp = null;
    this.prevActiveEffectTypes = new Set();
    this.leftPaddleHeight = 100;
    this.rightPaddleHeight = 100;
    this.powerUpBobOffset = 0;
    this.powerUpSpawnScale = 1;
    this.powerUpSpawnRingRadius = 0;
    this.powerUpSpawnRingAlpha = 0;
    this.prevP1HasCannon = false;
    this.prevP2HasCannon = false;
    this.prevExtraBallCount = 0;
    this.wasPaused = false;
  }
}
