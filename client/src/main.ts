import Phaser from 'phaser';
import { SocketManager } from './network/socket';
import { SynthAudio } from './audio/SynthAudio';
import { GameScene, setOnLeaveSpectate, setOnPauseChanged } from './scenes/GameScene';
import { GameOverScene, setOnPlayAgain } from './scenes/GameOverScene';
import type { GameStartPayload, QueueStatusPayload, ErrorPayload, RematchStatusPayload, MatchListPayload, GameEndPayload, TournamentCreatedPayload, TournamentStatePayload, BracketMatchInfo, PrivateLobbyCreatedPayload } from './types/messages';
import { TournamentState } from './types/messages';

// DOM elements
const lobby = document.getElementById('lobby')!;
const gameContainer = document.getElementById('game-container')!;
const nameInput = document.getElementById('name-input') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const queueStatus = document.getElementById('queue-status')!;
const lastResult = document.getElementById('last-result')!;
const matchList = document.getElementById('match-list')!;
const noMatches = document.getElementById('no-matches')!;
const refreshMatchesBtn = document.getElementById('refresh-matches-btn')!;
const createTournamentBtn = document.getElementById('create-tournament-btn')!;
const tournamentCodeInput = document.getElementById('tournament-code-input') as HTMLInputElement;
const joinTournamentBtn = document.getElementById('join-tournament-btn')!;
const tournamentLobby = document.getElementById('tournament-lobby')!;
const tournamentCodeDisplay = document.getElementById('tournament-code-display')!;
const tournamentSlots = document.querySelectorAll('.tournament-slot');
const startTournamentBtn = document.getElementById('start-tournament-btn')!;
const leaveTournamentBtn = document.getElementById('leave-tournament-btn')!;
const tournamentBracket = document.getElementById('tournament-bracket')!;
const bracketDisplay = document.getElementById('bracket-display')!;
const bracketStatus = document.getElementById('bracket-status')!;
const bracketContinue = document.getElementById('bracket-continue')!;
const bracketHeader = document.getElementById('bracket-header')!;
const championCelebration = document.getElementById('champion-celebration')!;
const championText = document.getElementById('champion-text')!;
const championRecap = document.getElementById('champion-recap')!;
const newTournamentBtn = document.getElementById('new-tournament-btn')!;
const bracketCloseBtn = document.getElementById('bracket-close-btn')!;
const bracketCloseBtnPending = document.getElementById('bracket-close-btn-pending')!;

// Pause menu DOM
const pauseMenu = document.getElementById('pause-menu')!;
const pauseResumeBtn = document.getElementById('pause-resume-btn')!;
const pauseSpectatorLinkBtn = document.getElementById('pause-spectator-link-btn')!;
const pauseSoundBtn = document.getElementById('pause-sound-btn')!;
const pauseLeaveBtn = document.getElementById('pause-leave-btn')!;
const pauseLinkStatus = document.getElementById('pause-link-status')!;
const pauseTauntLabel = document.getElementById('pause-taunt-label')!;

// Private lobby DOM
const createPrivateBtn = document.getElementById('create-private-btn')!;
const privateScoreSelect = document.getElementById('private-score-select') as HTMLSelectElement;
const privateCodeInput = document.getElementById('private-code-input') as HTMLInputElement;
const joinPrivateBtn = document.getElementById('join-private-btn')!;
const privateLobby = document.getElementById('private-lobby')!;
const privateCodeDisplay = document.getElementById('private-code-display')!;
const privateScoreValue = document.getElementById('private-score-value')!;
const privateSlotHost = document.getElementById('private-slot-host')!;
const cancelPrivateBtn = document.getElementById('cancel-private-btn')!;

// Lobby controls toggle
const controlsToggleBtn = document.getElementById('controls-toggle-btn')!;
const controlsPanel = document.getElementById('controls-panel')!;

let phaserGame: Phaser.Game | null = null;
let playerName = '';
let currentRoomId = '';
let isSpectating = false;
let matchListInterval: number | null = null;
let currentTournamentCode = '';
let isPaused = false;
let inPrivateLobby = false;
let continueSent = false;

// --- Mobile device detection ---
// Use pointer/hover media query to detect phones/tablets (touch-primary devices).
// This excludes desktop touchscreens which have hover:hover + pointer:fine.
const isMobileDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

// --- Mobile HUD elements ---
const mobileHud = document.getElementById('mobile-hud')!;
const mobilePauseBtn = document.getElementById('mobile-pause-btn')!;
const mobileControlsInfo = document.getElementById('controls-mobile-info');
const desktopControlsInfo = document.getElementById('controls-desktop-info');
const pauseControlsDesktop = document.getElementById('pause-controls-desktop')!;
const pauseControlsMobile = document.getElementById('pause-controls-mobile')!;
const pauseFooterText = document.getElementById('pause-footer-text')!;

// --- Socket setup ---
const socket = SocketManager.getInstance();
socket.connect();

// --- Connection status ---
socket.on('_connected', () => {
  queueStatus.textContent = '';
  // Re-enable join button when reconnected (if lobby is visible)
  if (!lobby.classList.contains('hidden') && joinBtn.disabled) {
    joinBtn.disabled = false;
  }
});

socket.on('_disconnected', () => {
  if (!lobby.classList.contains('hidden')) {
    queueStatus.textContent = 'Reconnecting...';
    queueStatus.style.color = '#f87171'; // red-400
  }
});

socket.on('_reconnect_failed', () => {
  queueStatus.textContent = 'Connection lost. Refresh the page.';
  queueStatus.style.color = '#f87171';
  joinBtn.disabled = false;
});

// --- Lobby logic ---
joinBtn.addEventListener('click', () => {
  playerName = nameInput.value.trim() || 'Player';
  nameInput.value = playerName;
  const sent = socket.send('join_queue', { name: playerName });
  if (sent) {
    joinBtn.disabled = true;
    queueStatus.textContent = 'Searching for opponent...';
    queueStatus.style.color = '';
  } else {
    queueStatus.textContent = 'Not connected. Retrying...';
    queueStatus.style.color = '#f87171';
  }
});

// Allow Enter key to join
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !joinBtn.disabled) {
    joinBtn.click();
  }
});

// --- HTML escape helper ---
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Match list polling ---
function startMatchListPolling(): void {
  if (matchListInterval) clearInterval(matchListInterval);
  matchListInterval = window.setInterval(() => {
    if (!lobby.classList.contains('hidden')) {
      socket.send('list_matches', {});
    } else {
      if (matchListInterval) {
        clearInterval(matchListInterval);
        matchListInterval = null;
      }
    }
  }, 5000);
}

// --- Refresh matches button ---
refreshMatchesBtn.addEventListener('click', () => {
  socket.send('list_matches', {});
});

// --- Tournament buttons ---
createTournamentBtn.addEventListener('click', () => {
  if (!playerName) {
    playerName = nameInput.value.trim() || 'Player';
    nameInput.value = playerName;
  }
  socket.send('create_tournament', { name: playerName });
});

joinTournamentBtn.addEventListener('click', () => {
  const code = tournamentCodeInput.value.trim().toUpperCase();
  if (!code) return;
  if (!playerName) {
    playerName = nameInput.value.trim() || 'Player';
    nameInput.value = playerName;
  }
  socket.send('join_tournament', { code, name: playerName });
});

tournamentCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinTournamentBtn.click();
});

startTournamentBtn.addEventListener('click', () => {
  socket.send('start_tournament', {});
});

leaveTournamentBtn.addEventListener('click', () => {
  socket.send('leave_tournament', {});
  tournamentLobby.classList.add('hidden');
  currentTournamentCode = '';
  lobby.classList.remove('hidden');
});

// Return to lobby from bracket (both Complete and pending buttons)
function returnToLobbyFromBracket(): void {
  tournamentBracket.classList.add('hidden');
  championCelebration.classList.add('hidden');
  currentTournamentCode = '';
  lobby.classList.remove('hidden');
  socket.send('list_matches', {});
  startMatchListPolling();
}

bracketCloseBtn.addEventListener('click', returnToLobbyFromBracket);
bracketCloseBtnPending.addEventListener('click', returnToLobbyFromBracket);

// New tournament button — create a fresh tournament from champion screen
newTournamentBtn.addEventListener('click', () => {
  tournamentBracket.classList.add('hidden');
  championCelebration.classList.add('hidden');
  currentTournamentCode = '';
  socket.send('create_tournament', { name: playerName });
});

// --- Private lobby buttons ---
createPrivateBtn.addEventListener('click', () => {
  if (!playerName) {
    playerName = nameInput.value.trim() || 'Player';
    nameInput.value = playerName;
  }
  const scoreToWin = parseInt(privateScoreSelect.value, 10) || 11;
  socket.send('create_private', { name: playerName, scoreToWin });
});

joinPrivateBtn.addEventListener('click', () => {
  const code = privateCodeInput.value.trim().toUpperCase();
  if (!code) return;
  if (!playerName) {
    playerName = nameInput.value.trim() || 'Player';
    nameInput.value = playerName;
  }
  socket.send('join_private', { code, name: playerName });
});

privateCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinPrivateBtn.click();
});

cancelPrivateBtn.addEventListener('click', () => {
  socket.send('leave_private', {});
  privateLobby.classList.add('hidden');
  inPrivateLobby = false;
  lobby.classList.remove('hidden');
});

// --- Private lobby socket listeners ---
socket.on('private_lobby_created', (payload: PrivateLobbyCreatedPayload) => {
  inPrivateLobby = true;
  privateCodeDisplay.textContent = payload.code;
  privateScoreValue.textContent = String(payload.scoreToWin);
  privateSlotHost.textContent = playerName;
  privateLobby.classList.remove('hidden');
});

// --- Lobby controls toggle ---
controlsToggleBtn.addEventListener('click', () => {
  const isOpen = !controlsPanel.classList.contains('hidden');
  controlsPanel.classList.toggle('hidden');
  controlsToggleBtn.textContent = isOpen ? 'HOW TO PLAY ▸' : 'HOW TO PLAY ▾';
});

// --- Match list handler ---
socket.on('match_list', (payload: MatchListPayload) => {
  matchList.innerHTML = '';
  if (payload.matches.length === 0) {
    noMatches.classList.remove('hidden');
  } else {
    noMatches.classList.add('hidden');
    for (const match of payload.matches) {
      const card = document.createElement('div');
      card.className = 'bg-neutral-900 border border-neutral-800 rounded px-3 py-2.5';
      card.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1 text-sm">
              <span class="text-cyan-400 font-bold truncate max-w-[90px] inline-block align-bottom">${escapeHtml(match.player1Name)}</span>
              <span class="text-neutral-600 flex-shrink-0">vs</span>
              <span class="text-fuchsia-400 font-bold truncate max-w-[90px] inline-block align-bottom">${escapeHtml(match.player2Name)}</span>
            </div>
            <div class="flex items-center gap-2 mt-1 text-xs">
              <span class="text-neutral-400 font-bold">${match.p1Score} - ${match.p2Score}</span>
              ${match.spectatorCount > 0 ? `<span class="text-neutral-600">\u{1F441} ${match.spectatorCount}</span>` : ''}
            </div>
          </div>
          <button class="watch-btn flex-shrink-0 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-3 py-1.5 rounded cursor-pointer transition-colors" data-room-id="${match.roomId}">WATCH</button>
        </div>
      `;
      matchList.appendChild(card);
    }
    // Wire up watch buttons
    matchList.querySelectorAll('.watch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = (btn as HTMLElement).dataset.roomId;
        if (roomId) {
          socket.send('spectate_match', { roomId });
        }
      });
    });
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
  // If in private lobby and it expired, dismiss overlay
  if (inPrivateLobby && payload.code === 'LOBBY_EXPIRED') {
    privateLobby.classList.add('hidden');
    inPrivateLobby = false;
    lobby.classList.remove('hidden');
  }
  queueStatus.textContent = payload.message;
  joinBtn.disabled = false;
});

// --- Game start: hide lobby, create Phaser ---
socket.on('game_start', (payload: GameStartPayload) => {
  hidePauseMenu();
  queueStatus.textContent = '';
  lobby.classList.add('hidden');
  tournamentBracket.classList.add('hidden');
  tournamentLobby.classList.add('hidden');
  privateLobby.classList.add('hidden');
  inPrivateLobby = false;
  gameContainer.classList.remove('hidden');
  currentRoomId = payload.roomId;
  isSpectating = payload.isSpectator || false;

  // Stop match list polling
  if (matchListInterval) {
    clearInterval(matchListInterval);
    matchListInterval = null;
  }

  phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    width: payload.arena.width,
    height: payload.arena.height,
    parent: 'game-container',
    backgroundColor: '#0a0a2e',
    scene: [GameScene, GameOverScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.NO_CENTER, // CSS flex on #game-container handles centering
    },
    input: {
      touch: true,
    },
  });

  // Pass game start data to the first scene (include isSpectator and isTournament)
  phaserGame.scene.start('GameScene', { ...payload, isTournament: !!currentTournamentCode });

  // Show mobile HUD on touch devices during gameplay
  if (isMobileDevice) {
    mobileHud.classList.remove('hidden');
  }
});

// --- Rematch accepted: destroy Phaser, game_start will arrive shortly ---
socket.on('rematch_status', (payload: RematchStatusPayload) => {
  if (payload.status === 'accepted') {
    currentRoomId = '';
    isSpectating = false;
    if (phaserGame) {
      phaserGame.destroy(true);
      phaserGame = null;
    }
    mobileHud.classList.add('hidden');
    gameContainer.innerHTML = '';
    // Don't show lobby — game_start is about to arrive
  }
});

// --- Play Again / Return to Lobby: destroy Phaser, show lobby ---
setOnPlayAgain(() => {
  const wasSpectating = isSpectating;
  currentRoomId = '';
  isSpectating = false;
  if (phaserGame) {
    phaserGame.destroy(true);
    phaserGame = null;
  }
  gameContainer.classList.add('hidden');
  mobileHud.classList.add('hidden');
  gameContainer.innerHTML = '';
  lobby.classList.remove('hidden');

  // Start match list polling
  socket.send('list_matches', {});
  startMatchListPolling();

  if (wasSpectating) {
    // Spectators just return to lobby
    joinBtn.disabled = false;
  } else {
    // Players: auto re-queue
    lastResult.textContent = 'Ready for another round?';
    setTimeout(() => { lastResult.textContent = ''; }, 3000);
    socket.send('join_queue', { name: playerName });
    joinBtn.disabled = true;
    queueStatus.textContent = 'Searching for opponent...';
  }
});

// --- Spectator/tournament leave callback (used by GameScene) ---
setOnLeaveSpectate(() => {
  isSpectating = false;
  currentRoomId = '';
  if (phaserGame) {
    phaserGame.destroy(true);
    phaserGame = null;
  }
  gameContainer.classList.add('hidden');
  mobileHud.classList.add('hidden');
  gameContainer.innerHTML = '';

  if (currentTournamentCode) {
    // Tournament: show bracket immediately (tournament_state will update content shortly)
    tournamentBracket.classList.remove('hidden');
    lobby.classList.add('hidden');
  } else {
    lobby.classList.remove('hidden');
    socket.send('list_matches', {});
    startMatchListPolling();
    joinBtn.disabled = false;
  }
});

// --- Server-authoritative pause callback (used by GameScene) ---
setOnPauseChanged((paused: boolean) => {
  if (paused) {
    showPauseMenu();
  } else {
    hidePauseMenu();
  }
});

// --- Game end handler ---
// Regular spectators see GameOverScene in Phaser before returning to lobby.
// Tournament participants (players + spectators) go back to bracket view.
// GameScene's handleGameEnd calls onLeaveSpectate for tournament matches,
// which handles Phaser cleanup. This handler is a safety net to ensure
// the bracket is always visible after a tournament game ends.
socket.on('game_end', (payload: GameEndPayload) => {
  // Hide mobile HUD on game-over screen (no need for taunts/pause there)
  mobileHud.classList.add('hidden');

  if (currentTournamentCode) {
    // Ensure bracket is visible for any tournament participant
    tournamentBracket.classList.remove('hidden');
    lobby.classList.add('hidden');
  }
});

// --- Tournament socket listeners ---
socket.on('tournament_created', (payload: TournamentCreatedPayload) => {
  currentTournamentCode = payload.code;
  tournamentCodeDisplay.textContent = payload.code;
  tournamentLobby.classList.remove('hidden');
});

socket.on('tournament_state', (payload: TournamentStatePayload) => {
  currentTournamentCode = payload.code;

  // Don't show bracket overlay while a game is actively running
  const gameIsActive = phaserGame !== null && !gameContainer.classList.contains('hidden');
  if (gameIsActive && payload.state !== TournamentState.Lobby && payload.state !== TournamentState.Complete) {
    // Game is in progress — just track the code, don't show bracket
    return;
  }

  updateTournamentUI(payload);
});

function updateTournamentUI(payload: TournamentStatePayload): void {
  if (payload.state === TournamentState.Lobby) {
    // Show tournament lobby
    tournamentLobby.classList.remove('hidden');
    tournamentBracket.classList.add('hidden');
    tournamentCodeDisplay.textContent = payload.code;

    // Update slots
    tournamentSlots.forEach((slot, i) => {
      if (i < payload.participants.length) {
        const p = payload.participants[i];
        (slot as HTMLElement).textContent = p.name;
        (slot as HTMLElement).className = 'tournament-slot bg-neutral-800 border border-cyan-400 rounded p-3 text-sm text-cyan-400 font-bold h-12 flex items-center justify-center';
      } else {
        (slot as HTMLElement).textContent = 'Waiting...';
        (slot as HTMLElement).className = 'tournament-slot bg-neutral-900 border border-neutral-700 rounded p-3 text-sm text-neutral-500 h-12 flex items-center justify-center';
      }
    });

    // Show START button only for host when full
    const myId = SocketManager.getInstance().myId;
    if (payload.hostId === myId && payload.participants.length === 4) {
      startTournamentBtn.classList.remove('hidden');
    } else {
      startTournamentBtn.classList.add('hidden');
    }
  } else {
    // Tournament in progress or complete -- show bracket
    tournamentLobby.classList.add('hidden');
    tournamentBracket.classList.remove('hidden');
    lobby.classList.add('hidden');

    renderBracket(payload);

    if (payload.state === TournamentState.Complete) {
      // Ensure Phaser is cleaned up when tournament completes
      if (phaserGame) {
        phaserGame.destroy(true);
        phaserGame = null;
        gameContainer.classList.add('hidden');
        gameContainer.innerHTML = '';
      }

      // Hide normal bracket header and status, show champion celebration
      bracketHeader.classList.add('hidden');
      bracketCloseBtnPending.classList.add('hidden');
      bracketStatus.textContent = '';
      bracketContinue.innerHTML = '';

      // Set champion name
      championText.textContent = payload.championName || 'CHAMPION';

      // Build match recap from bracket data
      const recapLines: string[] = [];
      if (payload.semiFinal1?.winnerId) {
        const sf1 = payload.semiFinal1;
        const w1 = sf1.winnerId === sf1.player1?.id ? sf1.player1?.name : sf1.player2?.name;
        recapLines.push(`<p>SF1: <span class="text-neutral-300">${escapeHtml(sf1.player1?.name || '?')}</span> <span class="text-neutral-500">${sf1.p1Score ?? 0}-${sf1.p2Score ?? 0}</span> <span class="text-neutral-300">${escapeHtml(sf1.player2?.name || '?')}</span> \u2192 <span class="text-green-400">${escapeHtml(w1 || '?')}</span></p>`);
      }
      if (payload.semiFinal2?.winnerId) {
        const sf2 = payload.semiFinal2;
        const w2 = sf2.winnerId === sf2.player1?.id ? sf2.player1?.name : sf2.player2?.name;
        recapLines.push(`<p>SF2: <span class="text-neutral-300">${escapeHtml(sf2.player1?.name || '?')}</span> <span class="text-neutral-500">${sf2.p1Score ?? 0}-${sf2.p2Score ?? 0}</span> <span class="text-neutral-300">${escapeHtml(sf2.player2?.name || '?')}</span> \u2192 <span class="text-green-400">${escapeHtml(w2 || '?')}</span></p>`);
      }
      if (payload.finalMatch?.winnerId) {
        const fin = payload.finalMatch;
        recapLines.push(`<p>Final: <span class="text-neutral-300">${escapeHtml(fin.player1?.name || '?')}</span> <span class="text-neutral-500">${fin.p1Score ?? 0}-${fin.p2Score ?? 0}</span> <span class="text-neutral-300">${escapeHtml(fin.player2?.name || '?')}</span></p>`);
      }
      championRecap.innerHTML = recapLines.join('');

      // Show celebration
      championCelebration.classList.remove('hidden');
    } else {
      // Hide champion celebration, show normal bracket UI
      championCelebration.classList.add('hidden');
      bracketHeader.classList.remove('hidden');
      // Show "Return to Lobby" for non-host users so they can leave bracket
      const myId2 = SocketManager.getInstance().myId;
      if (myId2 !== payload.hostId) {
        bracketCloseBtnPending.classList.remove('hidden');
      } else {
        bracketCloseBtnPending.classList.add('hidden');
      }

      // Build detailed status message with player names
      const sf1 = payload.semiFinal1;
      const sf2 = payload.semiFinal2;
      const sf1Done = !!sf1?.winnerId;
      const sf2Done = !!sf2?.winnerId;
      let statusText = '';
      if (payload.state === TournamentState.SemiFinal1) {
        if (!sf1Done && sf1?.player1?.name && sf1?.player2?.name) {
          statusText = `\u2694 Semi-Final 1: ${sf1.player1.name} vs ${sf1.player2.name}`;
        } else if (sf1Done) {
          statusText = '\u2714 SF1 complete \u2014 Semi-Final 2 starting soon\u2026';
        }
      } else if (payload.state === TournamentState.SemiFinal2) {
        if (!sf2Done && sf2?.player1?.name && sf2?.player2?.name) {
          statusText = `\u2694 Semi-Final 2: ${sf2.player1.name} vs ${sf2.player2.name}`;
        } else if (sf2Done) {
          statusText = '\u2714 Semis complete \u2014 Final starting soon\u2026';
        }
      } else if (payload.state === TournamentState.Final) {
        const fin = payload.finalMatch;
        if (fin?.player1?.name && fin?.player2?.name) {
          statusText = `\u2694 Final: ${fin.player1.name} vs ${fin.player2.name}`;
        } else {
          statusText = '\u2694 Final in progress\u2026';
        }
      }
      bracketStatus.textContent = statusText;

      // Show Continue button for host or waiting message for others
      if (payload.waitingForContinue) {
        const myId = SocketManager.getInstance().myId;
        const isHost = myId === payload.hostId;
        if (isHost) {
          // If we already sent continue, keep showing "STARTING..." to avoid duplicate sends
          if (continueSent) {
            bracketContinue.innerHTML = `
              <button class="bg-cyan-500 text-black font-bold px-8 py-3 rounded text-lg opacity-50 pointer-events-none cursor-not-allowed">
                STARTING...
              </button>
            `;
          } else {
            bracketContinue.innerHTML = `
              <button id="bracket-continue-btn" class="bg-cyan-500 text-black font-bold px-8 py-3 rounded text-lg hover:bg-cyan-400 transition-colors cursor-pointer">
                CONTINUE
              </button>
            `;
            const continueBtn = document.getElementById('bracket-continue-btn')!;
            continueBtn.addEventListener('click', () => {
              socket.send('continue_tournament', {});
              continueSent = true;
              continueBtn.textContent = 'STARTING...';
              continueBtn.classList.add('opacity-50', 'pointer-events-none');
            });
          }
        } else {
          bracketContinue.innerHTML = `
            <p class="text-neutral-500 text-sm animate-pulse">Waiting for host to continue\u2026</p>
          `;
        }
      } else {
        // Match started or state advanced — reset the flag
        continueSent = false;
        bracketContinue.innerHTML = '';
      }
    }
  }
}

function renderBracket(payload: TournamentStatePayload): void {
  const sf1 = payload.semiFinal1;
  const sf2 = payload.semiFinal2;
  const final_ = payload.finalMatch;

  // Status badge for a match
  const statusBadge = (match?: BracketMatchInfo, isActive?: boolean) => {
    if (!match) return '';
    if (match.winnerId) return '<span class="text-[10px] text-green-400 uppercase tracking-wider">\u2714 Complete</span>';
    if (isActive) return '<span class="text-[10px] text-yellow-400 uppercase tracking-wider animate-pulse">\u25B6 Now Playing</span>';
    return '<span class="text-[10px] text-neutral-600 uppercase tracking-wider">Upcoming</span>';
  };

  // Single player row within a match box
  const playerRow = (match: BracketMatchInfo, isP1: boolean) => {
    const player = isP1 ? match.player1 : match.player2;
    const name = player?.name || '?';
    const hasResult = !!match.winnerId;
    const isWinner = hasResult && match.winnerId === player?.id;
    const score = isP1 ? (match.p1Score ?? 0) : (match.p2Score ?? 0);

    let nameColor = isP1 ? 'text-cyan-400' : 'text-fuchsia-400';
    if (hasResult) {
      nameColor = isWinner ? 'text-green-400' : 'text-neutral-600';
    }

    return `
      <div class="flex items-center justify-between py-1">
        <span class="${nameColor} text-sm font-bold truncate max-w-[120px]">${isWinner ? '\u2714 ' : ''}${escapeHtml(name)}</span>
        ${hasResult ? `<span class="text-neutral-400 text-sm font-mono ml-2">${score}</span>` : ''}
      </div>
    `;
  };

  // Full match box
  const matchBox = (label: string, match?: BracketMatchInfo, isActive?: boolean) => {
    if (!match) {
      return `
        <div class="bg-neutral-900/80 border border-dashed border-neutral-700 rounded-lg p-3 w-[180px]">
          <div class="text-[10px] text-neutral-600 uppercase tracking-wider mb-2">${label}</div>
          <div class="text-neutral-600 text-xs text-center py-2">TBD</div>
        </div>
      `;
    }
    const hasResult = !!match.winnerId;
    const borderColor = isActive ? 'border-yellow-400' : (hasResult ? 'border-green-500/60' : 'border-neutral-700');
    const glowClass = isActive ? 'shadow-[0_0_12px_rgba(250,204,0,0.15)]' : '';

    return `
      <div class="bg-neutral-900/80 border ${borderColor} rounded-lg p-3 w-[180px] ${glowClass}">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] text-neutral-500 uppercase tracking-wider">${label}</span>
          ${statusBadge(match, isActive)}
        </div>
        <div class="border-t border-neutral-800 mt-1 pt-1">
          ${playerRow(match, true)}
          <div class="border-t border-neutral-800/50"></div>
          ${playerRow(match, false)}
        </div>
      </div>
    `;
  };

  // Horizontal connector line
  const hLine = () => `<div class="w-6 border-t-2 border-neutral-600 flex-shrink-0"></div>`;

  // Build symmetric bracket:
  //   SF1 ──── Final ──── SF2
  const isSF1Active = payload.state === TournamentState.SemiFinal1 && !sf1?.winnerId;
  const isSF2Active = payload.state === TournamentState.SemiFinal2 && !sf2?.winnerId;
  const isFinalActive = payload.state === TournamentState.Final && !final_?.winnerId;

  bracketDisplay.innerHTML = `
    <div class="flex items-center justify-center gap-0">
      <!-- Left: SF1 -->
      <div>
        ${matchBox('Semi-Final 1', sf1, isSF1Active)}
      </div>

      <!-- Left connector -->
      ${hLine()}

      <!-- Center: Final -->
      <div>
        ${matchBox('Final', final_, isFinalActive)}
      </div>

      <!-- Right connector -->
      ${hLine()}

      <!-- Right: SF2 -->
      <div>
        ${matchBox('Semi-Final 2', sf2, isSF2Active)}
      </div>
    </div>
  `;
}

// --- Pause menu ---
function showPauseMenu(): void {
  if (!phaserGame || lobby.classList.contains('hidden') === false) return; // Only pause during game
  isPaused = true;
  pauseMenu.classList.remove('hidden');
  mobileHud.classList.add('hidden'); // Hide mobile HUD behind pause menu
  pauseLinkStatus.classList.add('hidden');
  pauseSoundBtn.textContent = SynthAudio.isMuted() ? 'SOUND: OFF' : 'SOUND: ON';
  // Adjust for spectator mode
  if (isSpectating) {
    pauseSpectatorLinkBtn.classList.add('hidden');
    pauseTauntLabel.textContent = 'React\u2002😈 🔥 😂 💀 👋 GG';
    pauseLeaveBtn.textContent = 'STOP WATCHING';
  } else {
    pauseSpectatorLinkBtn.classList.remove('hidden');
    pauseTauntLabel.textContent = 'Taunt\u2002😈 🔥 😂 💀 👋 GG';
    pauseLeaveBtn.textContent = 'LEAVE MATCH';
  }
  // Toggle desktop/mobile controls in pause menu
  if (isMobileDevice) {
    pauseControlsDesktop.classList.add('hidden');
    pauseControlsMobile.classList.remove('hidden');
    pauseFooterText.textContent = 'Tap ⏸ to resume';
  } else {
    pauseControlsDesktop.classList.remove('hidden');
    pauseControlsMobile.classList.add('hidden');
    pauseFooterText.textContent = 'Press ESC to resume';
  }
}

function hidePauseMenu(): void {
  isPaused = false;
  pauseMenu.classList.add('hidden');
  // Restore mobile HUD when game resumes
  if (isMobileDevice && phaserGame && !gameContainer.classList.contains('hidden')) {
    mobileHud.classList.remove('hidden');
  }
}

// ESC key toggles pause menu during game
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isSpectating) {
      // Spectators: local-only pause menu (can't pause server game)
      if (isPaused) {
        hidePauseMenu();
      } else if (phaserGame && gameContainer.classList.contains('hidden') === false) {
        showPauseMenu();
      }
    } else if (phaserGame && gameContainer.classList.contains('hidden') === false) {
      // Players: send pause toggle to server (server-authoritative)
      socket.send('pause_game', {});
    }
  }
});

pauseResumeBtn.addEventListener('click', () => {
  if (isSpectating) {
    // Spectators: local-only pause menu
    hidePauseMenu();
  } else {
    // Players: send unpause to server
    socket.send('pause_game', {});
  }
});

// --- Mobile HUD: pause button ---
mobilePauseBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // Don't let the tap affect the game canvas
  if (isPaused) {
    // Resume
    if (isSpectating) {
      hidePauseMenu();
    } else {
      socket.send('pause_game', {});
    }
  } else if (phaserGame && !gameContainer.classList.contains('hidden')) {
    if (isSpectating) {
      showPauseMenu();
    } else {
      socket.send('pause_game', {});
    }
  }
});

// --- Mobile HUD: taunt buttons ---
document.querySelectorAll('.mobile-taunt-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPaused) return;
    const tauntId = parseInt((btn as HTMLElement).dataset.taunt || '1', 10);
    if (isSpectating) {
      socket.send('spectator_reaction', { reactionId: tauntId });
    } else {
      socket.send('taunt', { tauntId });
    }
  });
});

pauseSpectatorLinkBtn.addEventListener('click', () => {
  if (!currentRoomId) return;
  const url = `${window.location.origin}${window.location.pathname}?watch=${currentRoomId}`;
  navigator.clipboard.writeText(url).then(() => {
    pauseLinkStatus.textContent = 'Link copied to clipboard!';
    pauseLinkStatus.classList.remove('hidden');
    setTimeout(() => { pauseLinkStatus.classList.add('hidden'); }, 2500);
  }).catch(() => {
    // Fallback: select text for manual copy
    pauseLinkStatus.textContent = url;
    pauseLinkStatus.classList.remove('hidden');
  });
});

pauseSoundBtn.addEventListener('click', () => {
  const nowMuted = SynthAudio.toggleMute();
  pauseSoundBtn.textContent = nowMuted ? 'SOUND: OFF' : 'SOUND: ON';
});

pauseLeaveBtn.addEventListener('click', () => {
  hidePauseMenu();
  mobileHud.classList.add('hidden'); // Hide HUD before returning to lobby
  if (isSpectating) {
    // Leave spectator mode — same cleanup as setOnLeaveSpectate callback
    socket.send('leave_spectate', {});
    isSpectating = false;
    currentRoomId = '';
    if (phaserGame) {
      phaserGame.destroy(true);
      phaserGame = null;
    }
    gameContainer.classList.add('hidden');
    gameContainer.innerHTML = '';
    if (currentTournamentCode) {
      // Tournament: show bracket immediately
      tournamentBracket.classList.remove('hidden');
      lobby.classList.add('hidden');
    } else {
      lobby.classList.remove('hidden');
      socket.send('list_matches', {});
      startMatchListPolling();
      joinBtn.disabled = false;
    }
  } else {
    // Leave match (forfeit — send leave_match to server for clean forfeit)
    socket.send('leave_match', {});
    currentRoomId = '';
    isSpectating = false;
    if (phaserGame) {
      phaserGame.destroy(true);
      phaserGame = null;
    }
    gameContainer.classList.add('hidden');
    gameContainer.innerHTML = '';
    if (currentTournamentCode) {
      // Tournament forfeit: show bracket, tournament_state will update
      tournamentBracket.classList.remove('hidden');
      lobby.classList.add('hidden');
    } else {
      lobby.classList.remove('hidden');
      lastResult.textContent = 'You left the match';
      setTimeout(() => { lastResult.textContent = ''; }, 3000);
      joinBtn.disabled = false;
      socket.send('list_matches', {});
      startMatchListPolling();
    }
  }
});

// --- Auto-spectate from URL query param ---
function checkAutoSpectate(): void {
  const params = new URLSearchParams(window.location.search);
  const watchRoomId = params.get('watch');
  if (watchRoomId) {
    // Clean URL
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
    // Wait for connection, then spectate
    const trySpectate = () => {
      socket.send('spectate_match', { roomId: watchRoomId });
    };
    // If already connected, spectate immediately; otherwise wait
    if (socket.connected) {
      trySpectate();
    } else {
      socket.on('_connected', trySpectate);
    }
  }
}

// --- Server welcome: set client identity ---
socket.on('welcome', (payload: { id: string }) => {
  socket.setIdentity(payload.id, socket.myName || '');
});

// --- Connection status ---
socket.on('_connected', () => {
  joinBtn.disabled = false;
  socket.send('list_matches', {});
  startMatchListPolling();
});

socket.on('_disconnected', () => {
  joinBtn.disabled = true;
  queueStatus.textContent = 'Disconnected from server';
  // Dismiss private lobby overlay on disconnect
  if (inPrivateLobby) {
    privateLobby.classList.add('hidden');
    inPrivateLobby = false;
    lobby.classList.remove('hidden');
  }
});

// --- Touch device: toggle control info panels ---
if (isMobileDevice) {
  if (desktopControlsInfo) desktopControlsInfo.classList.add('hidden');
  if (mobileControlsInfo) mobileControlsInfo.classList.remove('hidden');
}

// Check for auto-spectate on load
checkAutoSpectate();
