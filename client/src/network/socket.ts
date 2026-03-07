import type { Envelope, ClientMessageType } from '../types/messages';

type MessageCallback = (payload: any) => void;

// Reconnection config
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;
const RECONNECT_MAX_ATTEMPTS = 20;

export class SocketManager {
  private static instance: SocketManager;
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<MessageCallback>> = new Map();
  private _myId: string = '';
  private _myName: string = '';
  private _connected: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose: boolean = false;

  private constructor() {}

  static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.intentionalClose = false;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectAttempts = 0;
      console.log('[socket] connected');
      this.dispatch('_connected', {});
    };

    this.ws.onclose = () => {
      const wasConnected = this._connected;
      this._connected = false;
      console.log('[socket] disconnected');
      this.dispatch('_disconnected', {});

      // Auto-reconnect unless intentionally closed
      if (!this.intentionalClose && this.reconnectAttempts < RECONNECT_MAX_ATTEMPTS) {
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(1.5, this.reconnectAttempts),
          RECONNECT_MAX_MS
        );
        this.reconnectAttempts++;
        console.log(`[socket] reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
          this.ws = null;
          this.connect();
        }, delay);
      } else if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
        console.error('[socket] max reconnect attempts reached');
        this.dispatch('_reconnect_failed', {});
      }
    };

    this.ws.onerror = (err) => {
      console.error('[socket] error', err);
    };

    this.ws.onmessage = (event: MessageEvent) => {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(event.data);
      } catch (e) {
        console.error('[socket] failed to parse message', e);
        return;
      }
      try {
        this.dispatch(envelope.type, envelope.payload);
      } catch (e) {
        console.error(`[socket] error in handler for "${envelope.type}"`, e);
      }
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  send<T>(type: ClientMessageType, payload: T): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[socket] not connected, dropping message:', type);
      return false;
    }
    const envelope: Envelope<T> = { type, payload };
    this.ws.send(JSON.stringify(envelope));
    return true;
  }

  on(type: string, callback: MessageCallback): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);
  }

  off(type: string, callback: MessageCallback): void {
    const set = this.listeners.get(type);
    if (set) set.delete(callback);
  }

  private dispatch(type: string, payload: unknown): void {
    const set = this.listeners.get(type);
    if (set) {
      for (const cb of set) {
        cb(payload);
      }
    }
  }

  setIdentity(id: string, name: string): void {
    this._myId = id;
    this._myName = name;
  }

  get myId(): string { return this._myId; }
  get myName(): string { return this._myName; }
}
