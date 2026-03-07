import Phaser from 'phaser';
import type { GameEndPayload, MatchStatsPayload, RematchStatusPayload, PlayerInfo } from '../types/messages';
import { SocketManager } from '../network/socket';

interface GameOverData extends GameEndPayload {
  myId: string;
  you?: PlayerInfo;
  opponent?: PlayerInfo;
}

// Callback set by main.ts to handle "play again"
export let onPlayAgain: (() => void) | null = null;

export function setOnPlayAgain(cb: () => void): void {
  onPlayAgain = cb;
}

export class GameOverScene extends Phaser.Scene {
  private result!: GameOverData;
  private autoReturnTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: 'GameOverScene' });
  }

  init(data: GameOverData): void {
    this.result = data;
  }

  create(): void {
    const isSpectator = this.result.isSpectator || false;
    const isWinner = !isSpectator && this.result.winnerId === this.result.myId;
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const centerX = w / 2;
    const centerY = h / 2;

    // --- Dark overlay background ---
    const overlay = this.add.graphics();
    overlay.fillStyle(0x050510, 0.85);
    overlay.fillRect(0, 0, w, h);

    // Glass card panel (centered, slightly translucent)
    const cardW = Math.min(360, w - 40);
    const cardH = Math.min(460, h - 40);
    const cardX = centerX - cardW / 2;
    const cardY = centerY - cardH / 2;
    const card = this.add.graphics();
    card.fillStyle(0xffffff, 0.03);
    card.fillRoundedRect(cardX, cardY, cardW, cardH, 16);
    card.lineStyle(1, 0xffffff, 0.08);
    card.strokeRoundedRect(cardX, cardY, cardW, cardH, 16);

    // Determine left/right player names for score label
    let leftName = '';
    let rightName = '';
    if (this.result.you && this.result.opponent) {
      if (this.result.you.side === 'left') {
        leftName = this.result.you.name;
        rightName = this.result.opponent.name;
      } else {
        leftName = this.result.opponent.name;
        rightName = this.result.you.name;
      }
    }

    // Generate particle texture if not cached
    if (!this.textures.exists('particle')) {
      const gfx = this.make.graphics({ x: 0, y: 0 });
      gfx.fillStyle(0xffffff);
      gfx.fillCircle(2, 2, 2);
      gfx.generateTexture('particle', 4, 4);
      gfx.destroy();
    }

    // --- Result headline — scale in from 0 ---
    let headlineText: string;
    let headlineColor: string;
    if (isSpectator) {
      headlineText = `${this.result.winnerName} WINS!`;
      headlineColor = '#facc15'; // gold
    } else {
      headlineText = isWinner ? 'YOU WIN!' : 'YOU LOSE';
      headlineColor = isWinner ? '#00f5ff' : '#ef4444'; // cyan for win, red for lose
    }

    const resultText = this.add.text(centerX, cardY + 50,
      headlineText, {
      fontSize: isSpectator ? '36px' : '44px',
      color: headlineColor,
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScale(0);

    this.tweens.add({
      targets: resultText,
      scaleX: 1, scaleY: 1,
      duration: 500,
      ease: 'Back.easeOut',
    });

    // --- Subtitle: winner name — slide in from left ---
    let subtitleBottomY = cardY + 80;
    if (!isSpectator) {
      const subtitleText = this.result.isForfeit
        ? 'Won by forfeit'
        : `${this.result.winnerName} wins`;
      const winnerText = this.add.text(-200, cardY + 85,
        subtitleText, {
        fontSize: '18px',
        color: '#6b7280',
        fontFamily: 'monospace',
      }).setOrigin(0.5);

      this.tweens.add({
        targets: winnerText,
        x: centerX,
        duration: 400,
        delay: 300,
        ease: 'Power2',
      });
      subtitleBottomY = cardY + 95;
    }

    // --- Player name labels above score ---
    if (leftName && rightName) {
      const nameY = subtitleBottomY + 15;
      const leftLabel = this.add.text(centerX - 60, nameY, leftName, {
        fontSize: '12px',
        color: '#00f5ff', // cyan
        fontFamily: 'monospace',
        fontStyle: 'bold',
      }).setOrigin(1, 0.5).setAlpha(0);

      const rightLabel = this.add.text(centerX + 60, nameY, rightName, {
        fontSize: '12px',
        color: '#ff00e5', // magenta
        fontFamily: 'monospace',
        fontStyle: 'bold',
      }).setOrigin(0, 0.5).setAlpha(0);

      this.tweens.add({
        targets: [leftLabel, rightLabel],
        alpha: 1,
        duration: 400,
        delay: 450,
      });
    }

    // --- Final score — fade in ---
    const scoreY = subtitleBottomY + 40;
    const scoreText = this.add.text(centerX, scoreY,
      `${this.result.finalScore.player1}  -  ${this.result.finalScore.player2}`, {
      fontSize: '34px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: scoreText,
      alpha: 1,
      duration: 400,
      delay: 500,
    });

    // --- Thin divider line ---
    const dividerY = scoreY + 28;
    const divider = this.add.graphics();
    divider.lineStyle(1, 0xffffff, 0.06);
    divider.lineBetween(cardX + 30, dividerY, cardX + cardW - 30, dividerY);
    divider.setAlpha(0);
    this.tweens.add({ targets: divider, alpha: 1, duration: 300, delay: 600 });

    // --- Match Stats ---
    let statsBottomY = dividerY + 10;
    if (this.result.stats) {
      const stats = this.result.stats;
      const statsStartY = dividerY + 16;
      const labelLeftX = centerX - 100;
      const valueRightX = centerX + 100;

      const statRows = [
        { label: 'Longest Rally', value: `${stats.longestRally}` },
        { label: 'Total Rallies', value: `${stats.totalRallies}` },
        { label: 'Power-ups', value: `${stats.p1PowerUps}  /  ${stats.p2PowerUps}` },
        { label: 'Max Speed', value: `${Math.round(stats.fastestBallSpeed)}` },
        { label: 'Paddle Dist', value: `${Math.round(stats.p1PaddleDistance)}  /  ${Math.round(stats.p2PaddleDistance)}` },
      ];

      statRows.forEach((row, i) => {
        const y = statsStartY + i * 22;
        const delay = 800 + i * 80;

        const label = this.add.text(labelLeftX, y, row.label, {
          fontSize: '11px',
          color: '#4b5563',
          fontFamily: 'monospace',
        }).setOrigin(0, 0.5).setAlpha(0);

        const val = this.add.text(valueRightX, y, row.value, {
          fontSize: '12px',
          color: '#d1d5db',
          fontFamily: 'monospace',
          fontStyle: 'bold',
        }).setOrigin(1, 0.5).setAlpha(0);

        this.tweens.add({ targets: [label, val], alpha: 1, duration: 300, delay });

        statsBottomY = y + 14;
      });
    }

    // --- Rematch / Forfeit / Spectator area ---
    const socket = SocketManager.getInstance();

    if (isSpectator) {
      const timerLabel = this.add.text(centerX, statsBottomY + 25, 'Returning to lobby...', {
        fontSize: '13px',
        color: '#4b5563',
        fontFamily: 'monospace',
      }).setOrigin(0.5).setAlpha(0);

      this.tweens.add({ targets: timerLabel, alpha: 1, duration: 300, delay: 600 });

      this.autoReturnTimer = this.time.delayedCall(8000, () => {
        if (onPlayAgain) onPlayAgain();
      });
    } else if (this.result.isForfeit) {
      const forfeitLabel = this.add.text(centerX, statsBottomY + 25, 'OPPONENT LEFT', {
        fontSize: '14px',
        color: '#4b5563',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      }).setOrigin(0.5).setAlpha(0);

      this.tweens.add({ targets: forfeitLabel, alpha: 1, duration: 300, delay: 600 });
    } else {
      // --- Rematch button (cyan neon) ---
      const rematchBtn = this.add.text(centerX, statsBottomY + 25, '[ REMATCH ]', {
        fontSize: '18px',
        color: '#00f5ff',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setAlpha(0);

      this.tweens.add({ targets: rematchBtn, alpha: 1, duration: 300, delay: 600 });

      rematchBtn.on('pointerover', () => rematchBtn.setColor('#ffffff'));
      rematchBtn.on('pointerout', () => rematchBtn.setColor('#00f5ff'));

      let rematchRequested = false;
      rematchBtn.on('pointerdown', () => {
        if (rematchRequested) return;
        rematchRequested = true;
        rematchBtn.setText('WAITING...');
        rematchBtn.setColor('#6b7280');
        rematchBtn.disableInteractive();
        socket.send('rematch_request', { roomId: this.result.roomId });
      });

      const onRematchStatus = (payload: RematchStatusPayload) => {
        if (payload.status === 'timeout' || payload.status === 'declined') {
          rematchBtn.setText('EXPIRED');
          rematchBtn.setColor('#4b5563');
          rematchBtn.disableInteractive();
        }
      };
      socket.on('rematch_status', onRematchStatus);

      this.events.on('shutdown', () => {
        socket.off('rematch_status', onRematchStatus);
      });
    }

    // --- Play again / Return to lobby button ---
    const btnText = isSpectator ? '[ RETURN TO LOBBY ]' : '[ PLAY AGAIN ]';
    const btn = this.add.text(centerX, statsBottomY + 60, btnText, {
      fontSize: '18px',
      color: '#d1d5db',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setAlpha(0);

    this.tweens.add({
      targets: btn,
      alpha: 1,
      duration: 300,
      delay: 700,
      onComplete: () => {
        this.tweens.add({
          targets: btn,
          scaleX: 1.04, scaleY: 1.04,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      },
    });

    btn.on('pointerover', () => btn.setColor('#00f5ff'));
    btn.on('pointerout', () => btn.setColor('#d1d5db'));
    btn.on('pointerdown', () => {
      if (this.autoReturnTimer) {
        this.autoReturnTimer.remove();
      }
      if (onPlayAgain) onPlayAgain();
    });

    // --- Victory confetti for the winner (not spectators) ---
    if (isWinner) {
      const zone = new Phaser.GameObjects.Particles.Zones.RandomZone(
        new Phaser.Geom.Rectangle(-200, 0, 400, 1) as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource
      );
      this.add.particles(centerX, -10, 'particle', {
        speed: { min: 30, max: 80 },
        angle: { min: 80, max: 100 },
        scale: { start: 1, end: 0 },
        alpha: { start: 0.7, end: 0 },
        lifespan: 2500,
        frequency: 40,
        tint: [0x00f5ff, 0x00c8ff, 0xff00e5, 0xfacc15, 0xffffff],
        emitZone: zone,
      });
    }
  }
}
