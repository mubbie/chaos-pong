import Phaser from 'phaser';
import type { GameEndPayload } from '../types/messages';

interface GameOverData extends GameEndPayload {
  myId: string;
}

// Callback set by main.ts to handle "play again"
export let onPlayAgain: (() => void) | null = null;

export function setOnPlayAgain(cb: () => void): void {
  onPlayAgain = cb;
}

export class GameOverScene extends Phaser.Scene {
  private result!: GameOverData;

  constructor() {
    super({ key: 'GameOverScene' });
  }

  init(data: GameOverData): void {
    this.result = data;
  }

  create(): void {
    const isWinner = this.result.winnerId === this.result.myId;
    const centerX = 400;
    const centerY = 300;

    // Generate particle texture if not cached
    if (!this.textures.exists('particle')) {
      const gfx = this.make.graphics({ x: 0, y: 0 });
      gfx.fillStyle(0xffffff);
      gfx.fillCircle(2, 2, 2);
      gfx.generateTexture('particle', 4, 4);
      gfx.destroy();
    }

    // Result text — scale in from 0
    const resultText = this.add.text(centerX, centerY - 80,
      isWinner ? 'YOU WIN!' : 'YOU LOSE', {
      fontSize: '48px',
      color: isWinner ? '#22c55e' : '#ef4444',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScale(0);

    this.tweens.add({
      targets: resultText,
      scaleX: 1, scaleY: 1,
      duration: 500,
      ease: 'Back.easeOut',
    });

    // Winner name — slide in from left
    const winnerText = this.add.text(-200, centerY - 20,
      `${this.result.winnerName} wins`, {
      fontSize: '20px',
      color: '#888888',
      fontFamily: 'monospace',
    }).setOrigin(0.5);

    this.tweens.add({
      targets: winnerText,
      x: centerX,
      duration: 400,
      delay: 300,
      ease: 'Power2',
    });

    // Final score — fade in
    const scoreText = this.add.text(centerX, centerY + 30,
      `${this.result.finalScore.player1} - ${this.result.finalScore.player2}`, {
      fontSize: '36px',
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

    // Play again button — fade in then pulse
    const btn = this.add.text(centerX, centerY + 110, '[ PLAY AGAIN ]', {
      fontSize: '20px',
      color: '#ffffff',
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
          scaleX: 1.05, scaleY: 1.05,
          duration: 800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      },
    });

    btn.on('pointerover', () => btn.setColor('#22c55e'));
    btn.on('pointerout', () => btn.setColor('#ffffff'));
    btn.on('pointerdown', () => {
      if (onPlayAgain) onPlayAgain();
    });

    // Victory confetti for the winner
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
        tint: [0x22c55e, 0x4ade80, 0x00f5ff, 0xff00e5, 0xffff00, 0xffffff],
        emitZone: zone,
      });
    }
  }
}
