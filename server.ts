import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { build as viteBuild, createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PlayerRole = 'P1' | 'P2';

interface ClientConn {
  id: string;
  currentRoomCode: string | null;
  role: PlayerRole | null;
  send: (payload: Record<string, unknown>) => void;
}

interface Room {
  code: string;
  p1: ClientConn | null;
  p2: ClientConn | null;
  activeTurn: PlayerRole;
  fortressPreset: string;
  matchActive: boolean;
}

const clients = new Map<string, ClientConn>();
const rooms = new Map<string, Room>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function randomWind(): number {
  const raw = Math.random() * 5 - 2.5;
  return Math.round(raw * 10) / 10;
}

function sendJson(client: ClientConn | null, payload: Record<string, unknown>): void {
  if (client) {
    client.send(payload);
  }
}

function cleanupClient(client: ClientConn): void {
  if (!client.currentRoomCode) return;
  const room = rooms.get(client.currentRoomCode);
  if (room) {
    const peer = client.role === 'P1' ? room.p2 : room.p1;
    sendJson(peer, { type: 'room:peer_left' });
    if (client.role === 'P1') room.p1 = null;
    if (client.role === 'P2') room.p2 = null;
    room.matchActive = false;
    if (!room.p1 && !room.p2) {
      rooms.delete(client.currentRoomCode);
    }
  }
  client.currentRoomCode = null;
  client.role = null;
}

function handleClientMessage(client: ClientConn, msg: Record<string, unknown>): void {
  const type = String(msg.type || '');

  if (type === 'room:create') {
    cleanupClient(client);
    const code = generateRoomCode();
    rooms.set(code, {
      code,
      p1: client,
      p2: null,
      activeTurn: 'P1',
      fortressPreset: 'classic',
      matchActive: false,
    });
    client.currentRoomCode = code;
    client.role = 'P1';
    sendJson(client, { type: 'room:created', code, role: 'P1' });
    return;
  }

  if (type === 'room:join') {
    const code = String(msg.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.p1) {
      sendJson(client, { type: 'room:error', message: 'Kode room tidak ditemukan.' });
      return;
    }
    if (room.p2) {
      sendJson(client, { type: 'room:error', message: 'Room sudah penuh.' });
      return;
    }
    cleanupClient(client);
    room.p2 = client;
    client.currentRoomCode = code;
    client.role = 'P2';
    sendJson(client, { type: 'room:joined', code, role: 'P2' });
    sendJson(room.p1, { type: 'room:ready', code });
    sendJson(room.p2, { type: 'room:ready', code });
    return;
  }

  if (type === 'room:leave') {
    cleanupClient(client);
    return;
  }

  if (!client.currentRoomCode || !client.role) return;
  const room = rooms.get(client.currentRoomCode);
  if (!room) return;
  const peer = client.role === 'P1' ? room.p2 : room.p1;

  if (type === 'match:start' || type === 'match:rematch') {
    if (client.role !== 'P1' && type === 'match:start') return;
    const preset =
      typeof msg.fortressPreset === 'string' ? msg.fortressPreset : room.fortressPreset;
    room.fortressPreset = preset;
    room.activeTurn = 'P1';
    room.matchActive = true;
    const wind = randomWind();
    const payload = {
      type: 'match:started',
      fortressPreset: room.fortressPreset,
      turn: room.activeTurn,
      wind,
    };
    sendJson(room.p1, payload);
    sendJson(room.p2, payload);
    return;
  }

  if (!room.matchActive) return;

  if (type === 'shot:aim') {
    if (client.role !== room.activeTurn) return;
    sendJson(peer, {
      type: 'shot:aim',
      by: client.role,
      pullX: Number(msg.pullX || 0),
      pullY: Number(msg.pullY || 0),
      bombType: String(msg.bombType || 'standard'),
    });
    return;
  }

  if (type === 'shot:fire') {
    if (client.role !== room.activeTurn) return;
    sendJson(peer, {
      type: 'shot:fired',
      by: client.role,
      vx: Number(msg.vx || 0),
      vy: Number(msg.vy || 0),
      bombType: String(msg.bombType || 'standard'),
    });
    return;
  }

  if (type === 'shot:ability') {
    if (client.role !== room.activeTurn) return;
    sendJson(peer, {
      type: 'shot:ability',
      by: client.role,
      x: Number(msg.x || 0),
      y: Number(msg.y || 0),
      vx: Number(msg.vx || 0),
      vy: Number(msg.vy || 0),
    });
    return;
  }

  if (type === 'turn:settled') {
    if (client.role !== room.activeTurn) return;
    const nextTurn: PlayerRole = room.activeTurn === 'P1' ? 'P2' : 'P1';
    room.activeTurn = nextTurn;
    const nextWind = randomWind();
    if (msg.winner) {
      room.matchActive = false;
    }
    const syncPayload = {
      type: 'turn:synced',
      nextTurn,
      nextWind,
      p1TowerHp: Number(msg.p1TowerHp ?? 220),
      p2TowerHp: Number(msg.p2TowerHp ?? 220),
      blocks: Array.isArray(msg.blocks) ? msg.blocks : [],
      winner: msg.winner ?? null,
      p1BlocksBroken: Number(msg.p1BlocksBroken ?? 0),
      p2BlocksBroken: Number(msg.p2BlocksBroken ?? 0),
    };
    sendJson(room.p1, syncPayload);
    sendJson(room.p2, syncPayload);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  let singleFileBuildPromise: Promise<void> | null = null;
  app.get('/api/download-html', async (_req, res) => {
    try {
      const distHtmlPath = path.resolve(__dirname, 'dist', 'index.html');
      if (!fs.existsSync(distHtmlPath)) {
        if (!singleFileBuildPromise) {
          singleFileBuildPromise = viteBuild()
            .then(() => undefined)
            .finally(() => {
              singleFileBuildPromise = null;
            });
        }
        await singleFileBuildPromise;
      }
      if (!fs.existsSync(distHtmlPath)) {
        res.status(500).json({ error: 'Gagal membuat file HTML.' });
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="benteng-bom.html"');
      res.sendFile(distHtmlPath);
    } catch (err) {
      console.error('Failed to build single-file HTML:', err);
      res.status(500).json({ error: 'Gagal mem-build file HTML tunggal.' });
    }
  });

  // HTTP SSE fallback for proxies where WebSocket upgrades fail
  app.get('/api/mp/stream', (req, res) => {
    const clientId = String(req.query.clientId || '').trim();
    if (!clientId) {
      res.status(400).end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const prev = clients.get(clientId);
    if (prev) {
      cleanupClient(prev);
      clients.delete(clientId);
    }

    const client: ClientConn = {
      id: clientId,
      currentRoomCode: null,
      role: null,
      send: (payload) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
      },
    };
    clients.set(clientId, client);
    res.write(`data: ${JSON.stringify({ type: 'transport:ready' })}\n\n`);

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      if (clients.get(clientId) === client) {
        cleanupClient(client);
        clients.delete(clientId);
      }
    });
  });

  app.post('/api/mp/send', (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const clientId = String(body?.clientId || '').trim();
    const client = clients.get(clientId);
    if (!client || !body) {
      res.status(404).json({ ok: false, error: 'Sesi belum terhubung.' });
      return;
    }
    handleClientMessage(client, body);
    res.json({ ok: true });
  });

  // Primary WebSocket transport
  wss.on('connection', (ws) => {
    const id = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const client: ClientConn = {
      id,
      currentRoomCode: null,
      role: null,
      send: (payload) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
        }
      },
    };
    clients.set(id, client);

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      handleClientMessage(client, msg);
    });

    ws.on('close', () => {
      if (clients.get(id) === client) {
        cleanupClient(client);
        clients.delete(id);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

startServer();
