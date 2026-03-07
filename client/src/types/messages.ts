// Envelope: top-level JSON wrapper for all WebSocket messages
export interface Envelope<T = unknown> {
  type: string;
  payload: T;
}

// --- Client → Server ---

export interface JoinQueuePayload {
  name: string;
}

export interface LeaveQueuePayload {}

export interface PlayerInputPayload {
  direction: -1 | 0 | 1;
}

export interface PingPayload {
  clientTime: number;
}

// --- Server → Client ---

export interface GameStatePayload {
  ball: BallState;
  player1: PlayerState;
  player2: PlayerState;
  status: GameStatus;
  tick: number;
  timestamp: number;
  powerUp?: PowerUpFieldState;
  activeEffects?: EffectState[];
  player1Effects: PlayerEffectsState;
  player2Effects: PlayerEffectsState;
  ballInvisible: boolean;
  shield?: ShieldState;
  extraBalls?: BallState[];
  paused?: boolean;
  pausedBy?: string;
  rallyCount?: number;
  paddleHit?: boolean;
  scoreToWin?: number;
}

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

export interface PlayerState {
  id: string;
  name: string;
  paddleY: number;
  paddleHeight: number;
  score: number;
}

export enum GameStatus {
  Waiting = 0,
  Countdown = 1,
  Playing = 2,
  Finished = 3,
}

export interface GameStartPayload {
  roomId: string;
  you: PlayerInfo;
  opponent: PlayerInfo;
  arena: ArenaInfo;
  countdown: number;
  isSpectator?: boolean;
  scoreToWin?: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  side: 'left' | 'right';
}

export interface ArenaInfo {
  width: number;
  height: number;
}

export interface ScoreUpdatePayload {
  scorerId: string;
  scorerName: string;
  player1Score: number;
  player2Score: number;
}

export interface GameEndPayload {
  winnerId: string;
  winnerName: string;
  finalScore: FinalScore;
  roomId: string;
  stats?: MatchStatsPayload;
  isSpectator?: boolean;
  isForfeit?: boolean;
}

export interface MatchStatsPayload {
  longestRally: number;
  totalRallies: number;
  p1PowerUps: number;
  p2PowerUps: number;
  fastestBallSpeed: number;
  p1PaddleDistance: number;
  p2PaddleDistance: number;
}

export interface FinalScore {
  player1: number;
  player2: number;
}

export interface QueueStatusPayload {
  status: string;
  position: number;
  playersInQueue: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface PongPayload {
  clientTime: number;
  serverTime: number;
}

// --- Taunts ---

export interface TauntPayload {
  tauntId: number;
}

export interface TauntBroadcastPayload {
  playerId: string;
  tauntId: number;
}

export const TAUNT_EMOJIS: Record<number, string> = {
  1: '😈',
  2: '🔥',
  3: '😂',
  4: '💀',
  5: '👋',
  6: 'GG',
};

// --- Rematch ---

export interface RematchRequestPayload {
  roomId: string;
}

export interface RematchStatusPayload {
  status: 'waiting' | 'accepted' | 'declined' | 'timeout';
  roomId: string;
}

// --- Spectator ---

export interface MatchInfo {
  roomId: string;
  player1Name: string;
  player2Name: string;
  p1Score: number;
  p2Score: number;
  spectatorCount: number;
}

export interface MatchListPayload {
  matches: MatchInfo[];
}

export interface SpectateMatchPayload {
  roomId: string;
}

export interface SpectatorReactionPayload {
  reactionId: number;
}

export interface SpectatorReactionBroadcast {
  spectatorName: string;
  reactionId: number;
}

export interface SpectatorInfoPayload {
  player1Name: string;
  player2Name: string;
  p1Score: number;
  p2Score: number;
}

export const REACTION_EMOJIS: Record<number, string> = {
  1: '\u{1F608}',
  2: '\u{1F525}',
  3: '\u{1F602}',
  4: '\u{1F480}',
  5: '\u{1F44B}',
  6: 'GG',
};

// --- Tournament ---

export enum TournamentState {
  Lobby = 0,
  SemiFinal1 = 1,
  SemiFinal2 = 2,
  Final = 3,
  Complete = 4,
}

export interface CreateTournamentPayload {
  name: string;
}

export interface JoinTournamentPayload {
  code: string;
  name: string;
}

export interface StartTournamentPayload {}

export interface TournamentCreatedPayload {
  code: string;
}

export interface ParticipantInfo {
  id: string;
  name: string;
}

export interface BracketMatchInfo {
  player1?: ParticipantInfo;
  player2?: ParticipantInfo;
  winnerId?: string;
  p1Score?: number;
  p2Score?: number;
}

export interface TournamentStatePayload {
  code: string;
  state: number;
  participants: ParticipantInfo[];
  hostId: string;
  semiFinal1?: BracketMatchInfo;
  semiFinal2?: BracketMatchInfo;
  finalMatch?: BracketMatchInfo;
  championId?: string;
  championName?: string;
  waitingForContinue?: boolean;
  activeRoomId?: string;
}

// --- Power-up types ---

export enum PowerUpType {
  BigPaddle = 1,
  Shrink = 2,
  SpeedBoost = 3,
  CannonShot = 4,
  Freeze = 5,
  ReverseControls = 6,
  GhostBall = 7,
  Shield = 8,
  MultiBall = 9,
}

export interface PowerUpFieldState {
  type: number;
  x: number;
  y: number;
}

export interface EffectState {
  type: number;
  ownerId: string;
  ticksLeft: number;
}

export interface PlayerEffectsState {
  paddleHeight: number;
  frozen: boolean;
  reversed: boolean;
  hasCannon: boolean;
}

export interface ShieldState {
  active: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  side: number; // 0=left, 1=right
}

export const POWERUP_NAMES: Record<number, string> = {
  [PowerUpType.BigPaddle]: 'BIG PADDLE',
  [PowerUpType.Shrink]: 'SHRINK',
  [PowerUpType.SpeedBoost]: 'SPEED BOOST',
  [PowerUpType.CannonShot]: 'CANNON SHOT',
  [PowerUpType.Freeze]: 'FREEZE',
  [PowerUpType.ReverseControls]: 'REVERSE',
  [PowerUpType.GhostBall]: 'GHOST BALL',
  [PowerUpType.Shield]: 'SHIELD',
  [PowerUpType.MultiBall]: 'MULTI-BALL',
};

export const POWERUP_COLORS: Record<number, number> = {
  [PowerUpType.BigPaddle]: 0x22c55e,       // green
  [PowerUpType.Shrink]: 0xff8800,           // orange
  [PowerUpType.SpeedBoost]: 0xffff00,       // yellow
  [PowerUpType.CannonShot]: 0xff0044,       // red
  [PowerUpType.Freeze]: 0x88ccff,           // light blue
  [PowerUpType.ReverseControls]: 0xaa44ff,  // purple
  [PowerUpType.GhostBall]: 0xffffff,        // white
  [PowerUpType.Shield]: 0xffd700,           // gold
  [PowerUpType.MultiBall]: 0xff6600,        // orange-red
};

// --- Private Lobby ---

export interface PrivateLobbyCreatedPayload {
  code: string;
  scoreToWin: number;
}

export type ClientMessageType = 'join_queue' | 'leave_queue' | 'player_input' | 'ping' | 'taunt' | 'rematch_request' | 'list_matches' | 'spectate_match' | 'leave_spectate' | 'spectator_reaction' | 'create_tournament' | 'join_tournament' | 'start_tournament' | 'continue_tournament' | 'leave_tournament' | 'leave_match' | 'pause_game' | 'create_private' | 'join_private' | 'leave_private';
export type ServerMessageType = 'game_state' | 'game_start' | 'score_update' | 'game_end' | 'queue_status' | 'error' | 'pong' | 'taunt' | 'rematch_status' | 'match_list' | 'spectator_reaction' | 'spectator_info' | 'tournament_created' | 'tournament_state' | 'private_lobby_created';
