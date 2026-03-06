import Phaser from 'phaser';
import { SocketManager } from './network/socket';
import { GameScene } from './scenes/GameScene';
import { GameOverScene, setOnPlayAgain } from './scenes/GameOverScene';
import type { GameStartPayload, QueueStatusPayload, ErrorPayload } from './types/messages';

// DOM elements
const lobby = document.getElementById('lobby')!;
const gameContainer = document.getElementById('game-container')!;
const nameInput = document.getElementById('name-input') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const queueStatus = document.getElementById('queue-status')!;
const lastResult = document.getElementById('last-result')!;

let phaserGame: Phaser.Game | null = null;
let playerName = '';

// --- Socket setup ---
const socket = SocketManager.getInstance();
socket.connect();

// --- Lobby logic ---
joinBtn.addEventListener('click', () => {
  playerName = nameInput.value.trim() || 'Player';
  nameInput.value = playerName;
  socket.send('join_queue', { name: playerName });
  joinBtn.disabled = true;
  queueStatus.textContent = 'Searching for opponent...';
});

// Allow Enter key to join
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !joinBtn.disabled) {
    joinBtn.click();
  }
});

socket.on('queue_status', (payload: QueueStatusPayload) => {
  if (payload.status === 'waiting') {
    queueStatus.textContent = `Waiting for opponent... (${payload.playersInQueue} in queue)`;
  } else if (payload.status === 'left') {
    queueStatus.textContent = '';
    joinBtn.disabled = false;
  }
});

socket.on('error', (payload: ErrorPayload) => {
  queueStatus.textContent = payload.message;
  joinBtn.disabled = false;
});

// --- Game start: hide lobby, create Phaser ---
socket.on('game_start', (payload: GameStartPayload) => {
  queueStatus.textContent = '';
  lobby.classList.add('hidden');
  gameContainer.classList.remove('hidden');

  phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    width: payload.arena.width,
    height: payload.arena.height,
    parent: 'game-container',
    backgroundColor: '#0a0a2e',
    scene: [GameScene, GameOverScene],
  });

  // Pass game start data to the first scene
  phaserGame.scene.start('GameScene', payload);
});

// --- Play Again: destroy Phaser, show lobby, re-queue ---
setOnPlayAgain(() => {
  if (phaserGame) {
    phaserGame.destroy(true);
    phaserGame = null;
  }
  gameContainer.classList.add('hidden');
  gameContainer.innerHTML = '';
  lobby.classList.remove('hidden');

  // Show last result briefly
  lastResult.textContent = 'Ready for another round?';
  setTimeout(() => { lastResult.textContent = ''; }, 3000);

  // Auto re-queue
  socket.send('join_queue', { name: playerName });
  joinBtn.disabled = true;
  queueStatus.textContent = 'Searching for opponent...';
});

// --- Connection status ---
socket.on('_connected', () => {
  joinBtn.disabled = false;
});

socket.on('_disconnected', () => {
  joinBtn.disabled = true;
  queueStatus.textContent = 'Disconnected from server';
});
