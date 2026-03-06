import type { Envelope, ClientMessageType } from '../types/messages';

type MessageCallback = (payload: any) => void;

export class SocketManager {
  private static instance: SocketManager;
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<MessageCallback>> = new Map();
  private _myId: string = '';
  private _myName: string = '';
  private _connected: boolean = false;

  private constructor() {}

  static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);

    this.ws.onopen = () => {
      this._connected = true;
      console.log('[socket] connected');
      this.dispatch('_connected', {});
    };

    this.ws.onclose = () => {
      this._connected = false;
      console.log('[socket] disconnected');
      this.dispatch('_disconnected', {});
    };

    this.ws.onerror = (err) => {
      console.error('[socket] error', err);
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const envelope: Envelope = JSON.parse(event.data);
        this.dispatch(envelope.type, envelope.payload);
      } catch (e) {
        console.error('[socket] failed to parse message', e);
      }
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  send<T>(type: ClientMessageType, payload: T): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[socket] not connected, dropping message:', type);
      return;
    }
    const envelope: Envelope<T> = { type, payload };
    this.ws.send(JSON.stringify(envelope));
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
