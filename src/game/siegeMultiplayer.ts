import { BlockSyncData, BombType, FortressPreset, PlayerSide } from './siegeTypes';

export interface SiegeMultiplayerHandlers {
  onRoomCreated: (code: string) => void;
  onRoomJoined: (code: string) => void;
  onRoomReady: (code: string) => void;
  onMatchStarted: (payload: {
    fortressPreset: FortressPreset;
    turn: PlayerSide;
    wind: number;
  }) => void;
  onPeerLeft: () => void;
  onError: (message: string) => void;
  onRemoteAim: (payload: {
    by: PlayerSide;
    pullX: number;
    pullY: number;
    bombType: BombType;
  }) => void;
  onRemoteFired: (payload: {
    by: PlayerSide;
    vx: number;
    vy: number;
    bombType: BombType;
  }) => void;
  onRemoteAbility: (payload: {
    by: PlayerSide;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }) => void;
  onTurnSynced: (payload: {
    nextTurn: PlayerSide;
    nextWind: number;
    p1TowerHp: number;
    p2TowerHp: number;
    blocks: BlockSyncData[];
    winner: PlayerSide | null;
    p1BlocksBroken: number;
    p2BlocksBroken: number;
  }) => void;
}

type TransportMode = 'none' | 'ws' | 'sse';

export class SiegeMultiplayerClient {
  private ws: WebSocket | null = null;
  private sse: EventSource | null = null;
  private sseClientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  private transport: TransportMode = 'none';
  private connecting = false;
  private pendingCallbacks: Array<() => void> = [];
  private handlers: SiegeMultiplayerHandlers;

  constructor(handlers: SiegeMultiplayerHandlers) {
    this.handlers = handlers;
  }

  private isOfflineFile(): boolean {
    return window.location.protocol === 'file:' || !window.location.host;
  }

  private flushPending(): void {
    const queue = this.pendingCallbacks.splice(0, this.pendingCallbacks.length);
    for (const cb of queue) {
      cb();
    }
  }

  private handleIncoming(rawData: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return;
    }

    const type = String(msg.type || '');
    if (type === 'transport:ready') {
      return;
    } else if (type === 'room:created') {
      this.handlers.onRoomCreated(String(msg.code || ''));
    } else if (type === 'room:joined') {
      this.handlers.onRoomJoined(String(msg.code || ''));
    } else if (type === 'room:ready') {
      this.handlers.onRoomReady(String(msg.code || ''));
    } else if (type === 'match:started') {
      this.handlers.onMatchStarted({
        fortressPreset: (msg.fortressPreset as FortressPreset) || 'classic',
        turn: msg.turn === 'P2' ? 'P2' : 'P1',
        wind: Number(msg.wind || 0),
      });
    } else if (type === 'room:peer_left') {
      this.handlers.onPeerLeft();
    } else if (type === 'room:error') {
      this.handlers.onError(String(msg.message || 'Terjadi kesalahan koneksi.'));
    } else if (type === 'shot:aim') {
      this.handlers.onRemoteAim({
        by: msg.by === 'P2' ? 'P2' : 'P1',
        pullX: Number(msg.pullX || 0),
        pullY: Number(msg.pullY || 0),
        bombType: (msg.bombType as BombType) || 'standard',
      });
    } else if (type === 'shot:fired') {
      this.handlers.onRemoteFired({
        by: msg.by === 'P2' ? 'P2' : 'P1',
        vx: Number(msg.vx || 0),
        vy: Number(msg.vy || 0),
        bombType: (msg.bombType as BombType) || 'standard',
      });
    } else if (type === 'shot:ability') {
      this.handlers.onRemoteAbility({
        by: msg.by === 'P2' ? 'P2' : 'P1',
        x: Number(msg.x || 0),
        y: Number(msg.y || 0),
        vx: Number(msg.vx || 0),
        vy: Number(msg.vy || 0),
      });
    } else if (type === 'turn:synced') {
      this.handlers.onTurnSynced({
        nextTurn: msg.nextTurn === 'P2' ? 'P2' : 'P1',
        nextWind: Number(msg.nextWind || 0),
        p1TowerHp: Number(msg.p1TowerHp ?? 220),
        p2TowerHp: Number(msg.p2TowerHp ?? 220),
        blocks: Array.isArray(msg.blocks) ? (msg.blocks as BlockSyncData[]) : [],
        winner: msg.winner === 'P1' || msg.winner === 'P2' ? msg.winner : null,
        p1BlocksBroken: Number(msg.p1BlocksBroken ?? 0),
        p2BlocksBroken: Number(msg.p2BlocksBroken ?? 0),
      });
    }
  }

  private connectSseFallback(): void {
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }

    const url = `/api/mp/stream?clientId=${encodeURIComponent(this.sseClientId)}`;
    const es = new EventSource(url);
    this.sse = es;

    const timeoutId = window.setTimeout(() => {
      if (this.transport !== 'sse') {
        es.close();
        this.sse = null;
        this.connecting = false;
        this.pendingCallbacks = [];
        this.handlers.onError('Gagal terhubung ke server Mabar.');
      }
    }, 5000);

    es.onopen = () => {
      window.clearTimeout(timeoutId);
      this.transport = 'sse';
      this.connecting = false;
      this.flushPending();
    };

    es.onmessage = (event) => {
      this.handleIncoming(String(event.data));
    };

    es.onerror = () => {
      if (this.transport !== 'sse') {
        window.clearTimeout(timeoutId);
        es.close();
        this.sse = null;
        this.connecting = false;
        this.pendingCallbacks = [];
        this.handlers.onError('Gagal terhubung ke server Mabar.');
      }
    };
  }

  private ensureConnected(onOpen?: () => void): void {
    if (this.isOfflineFile()) {
      this.handlers.onError(
        'File HTML offline hanya mendukung Main Berdua (1 Layar) dan Lawan Bot. Untuk Mabar Online, buka lewat link web.'
      );
      return;
    }

    if (
      (this.transport === 'ws' && this.ws && this.ws.readyState === WebSocket.OPEN) ||
      (this.transport === 'sse' && this.sse && this.sse.readyState === EventSource.OPEN)
    ) {
      onOpen?.();
      return;
    }

    if (onOpen) {
      this.pendingCallbacks.push(onOpen);
    }

    if (this.connecting) return;
    this.connecting = true;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.connectSseFallback();
      return;
    }
    this.ws = ws;

    let fellBack = false;
    const triggerFallback = () => {
      if (fellBack || this.transport === 'ws') return;
      fellBack = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
      this.connectSseFallback();
    };

    const wsTimeout = window.setTimeout(triggerFallback, 1800);

    ws.onopen = () => {
      if (fellBack) {
        ws.close();
        return;
      }
      window.clearTimeout(wsTimeout);
      this.transport = 'ws';
      this.connecting = false;
      this.flushPending();
    };

    ws.onmessage = (event) => {
      this.handleIncoming(String(event.data));
    };

    ws.onerror = () => {
      window.clearTimeout(wsTimeout);
      if (this.transport !== 'ws') {
        triggerFallback();
      }
    };

    ws.onclose = () => {
      window.clearTimeout(wsTimeout);
      if (this.transport === 'ws') {
        this.transport = 'none';
      } else {
        triggerFallback();
      }
    };
  }

  private send(payload: Record<string, unknown>): void {
    if (this.transport === 'ws' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return;
    }
    if (this.transport === 'sse') {
      fetch('/api/mp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: this.sseClientId, ...payload }),
      }).catch(() => {});
    }
  }

  public createRoom(): void {
    this.ensureConnected(() => {
      this.send({ type: 'room:create' });
    });
  }

  public joinRoom(code: string): void {
    this.ensureConnected(() => {
      this.send({ type: 'room:join', code: code.trim().toUpperCase() });
    });
  }

  public startMatch(fortressPreset: FortressPreset): void {
    this.send({ type: 'match:start', fortressPreset });
  }

  public requestRematch(fortressPreset: FortressPreset): void {
    this.send({ type: 'match:rematch', fortressPreset });
  }

  public leaveRoom(): void {
    this.send({ type: 'room:leave' });
  }

  public sendAim(pullX: number, pullY: number, bombType: BombType): void {
    this.send({ type: 'shot:aim', pullX, pullY, bombType });
  }

  public sendFire(vx: number, vy: number, bombType: BombType): void {
    this.send({ type: 'shot:fire', vx, vy, bombType });
  }

  public sendAbility(x: number, y: number, vx: number, vy: number): void {
    this.send({ type: 'shot:ability', x, y, vx, vy });
  }

  public sendTurnSettled(payload: {
    p1TowerHp: number;
    p2TowerHp: number;
    blocks: BlockSyncData[];
    winner: PlayerSide | null;
    p1BlocksBroken: number;
    p2BlocksBroken: number;
  }): void {
    this.send({ type: 'turn:settled', ...payload });
  }

  public dispose(): void {
    this.pendingCallbacks = [];
    this.connecting = false;
    this.transport = 'none';
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
  }
}
