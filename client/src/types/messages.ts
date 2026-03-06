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

export type ClientMessageType = 'join_queue' | 'leave_queue' | 'player_input' | 'ping';
export type ServerMessageType = 'game_state' | 'game_start' | 'score_update' | 'game_end' | 'queue_status' | 'error' | 'pong';
