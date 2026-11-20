import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Copy,
  Download,
  Eye,
  Flame,
  Home,
  RotateCcw,
  Shield,
  Swords,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { SiegeEngine } from './game/siegeEngine';
import { SiegeMultiplayerClient } from './game/siegeMultiplayer';
import { siegeSound } from './game/siegeSound';
import {
  BOMB_SPECS,
  BombType,
  FORTRESS_PRESETS,
  FortressPreset,
  MAX_TOWER_HP,
  PlayerSide,
  SiegeHudState,
} from './game/siegeTypes';

type MenuView = 'main' | 'online' | 'room_host' | 'room_guest';

const INITIAL_HUD: SiegeHudState = {
  phase: 'TITLE_MENU',
  turnPhase: 'AIMING',
  activeTurn: 'P1',
  playMode: 'local',
  localRole: null,
  wind: 0,
  turnCount: 1,
  p1TowerHp: MAX_TOWER_HP,
  p2TowerHp: MAX_TOWER_HP,
  maxTowerHp: MAX_TOWER_HP,
  p1Arsenal: { standard: -1, cluster: 2, heavy: 2 },
  p2Arsenal: { standard: -1, cluster: 2, heavy: 2 },
  selectedBomb: 'standard',
  canSplitMidAir: false,
  overviewMode: false,
  winner: null,
  p1Shots: 0,
  p2Shots: 0,
  p1BlocksBroken: 0,
  p2BlocksBroken: 0,
  statusBanner: 'Giliran Pemain 1',
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SiegeEngine | null>(null);
  const mpRef = useRef<SiegeMultiplayerClient | null>(null);
  const roleRef = useRef<PlayerSide | null>(null);

  const [hud, setHud] = useState<SiegeHudState>(INITIAL_HUD);
  const [preset, setPreset] = useState<FortressPreset>('classic');
  const [muted, setMuted] = useState(false);

  const [menuView, setMenuView] = useState<MenuView>('main');
  const [roomCode, setRoomCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [roomReady, setRoomReady] = useState(false);
  const [lobbyError, setLobbyError] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloadingHtml, setDownloadingHtml] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mp = new SiegeMultiplayerClient({
      onRoomCreated: (code) => {
        roleRef.current = 'P1';
        setRoomCode(code);
        setRoomReady(false);
        setLobbyError('');
        setMenuView('room_host');
      },
      onRoomJoined: (code) => {
        roleRef.current = 'P2';
        setRoomCode(code);
        setLobbyError('');
        setMenuView('room_guest');
      },
      onRoomReady: () => {
        setRoomReady(true);
      },
      onMatchStarted: ({ fortressPreset, turn, wind }) => {
        setPreset(fortressPreset);
        engineRef.current?.startNewMatch({
          mode: 'online',
          preset: fortressPreset,
          localRole: roleRef.current,
          initialTurn: turn,
          initialWind: wind,
        });
      },
      onPeerLeft: () => {
        setRoomReady(false);
        setLobbyError('Teman keluar dari room.');
      },
      onError: (msg) => {
        setLobbyError(msg);
      },
      onRemoteAim: ({ by, pullX, pullY, bombType }) => {
        engineRef.current?.applyRemoteAim(by, pullX, pullY, bombType);
      },
      onRemoteFired: ({ by, vx, vy, bombType }) => {
        engineRef.current?.applyRemoteFired(by, vx, vy, bombType);
      },
      onRemoteAbility: ({ by, x, y, vx, vy }) => {
        engineRef.current?.applyRemoteAbility(by, x, y, vx, vy);
      },
      onTurnSynced: (payload) => {
        engineRef.current?.applyOnlineTurnSync(payload);
      },
    });
    mpRef.current = mp;

    const engine = new SiegeEngine(canvas, {
      onHudChange: (next) => setHud(next),
      onOnlineAimEmit: (pullX, pullY, bombType) => mp.sendAim(pullX, pullY, bombType),
      onOnlineFireEmit: (vx, vy, bombType) => mp.sendFire(vx, vy, bombType),
      onOnlineAbilityEmit: (x, y, vx, vy) => mp.sendAbility(x, y, vx, vy),
      onOnlineTurnSettled: (payload) => mp.sendTurnSettled(payload),
    });
    engineRef.current = engine;

    return () => {
      mp.dispose();
      mpRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    siegeSound.setMuted(next);
  };

  const handleStartLocal = () => {
    roleRef.current = null;
    engineRef.current?.startNewMatch({ mode: 'local', preset });
  };

  const handleStartBot = () => {
    roleRef.current = null;
    engineRef.current?.startNewMatch({ mode: 'bot', preset });
  };

  const handleCreateRoom = () => {
    setLobbyError('');
    mpRef.current?.createRoom();
  };

  const handleJoinRoom = () => {
    const cleaned = joinInput.trim().toUpperCase();
    if (cleaned.length < 4) {
      setLobbyError('Masukkan kode room dengan benar.');
      return;
    }
    setLobbyError('');
    mpRef.current?.joinRoom(cleaned);
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored
    }
  };

  const handleLeaveOnlineLobby = () => {
    mpRef.current?.leaveRoom();
    roleRef.current = null;
    setRoomCode('');
    setRoomReady(false);
    setLobbyError('');
    setMenuView('main');
  };

  const handleBackToMenu = () => {
    if (hud.playMode === 'online') {
      mpRef.current?.leaveRoom();
      roleRef.current = null;
      setRoomCode('');
      setRoomReady(false);
    }
    setMenuView('main');
    engineRef.current?.returnToMenu();
  };

  const handleRematch = () => {
    if (hud.playMode === 'online') {
      mpRef.current?.requestRematch(preset);
    } else {
      engineRef.current?.startNewMatch({ mode: hud.playMode, preset });
    }
  };

  const handleDownloadFullHtml = async () => {
    if (downloadingHtml) return;
    setDownloadingHtml(true);
    setDownloadError('');
    try {
      const res = await fetch('/api/download-html');
      if (!res.ok) throw new Error('Gagal mengunduh');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'benteng-bom.html';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError('Gagal mengunduh file HTML. Coba lagi sebentar.');
    } finally {
      setDownloadingHtml(false);
    }
  };

  const isLocalFile =
    typeof window !== 'undefined' && window.location.protocol === 'file:';

  const isLocalTurnToAim =
    hud.phase === 'PLAYING' &&
    hud.turnPhase === 'AIMING' &&
    (hud.playMode === 'local' ||
      (hud.playMode === 'bot' && hud.activeTurn === 'P1') ||
      (hud.playMode === 'online' && hud.activeTurn === hud.localRole));

  const activeArsenal = hud.activeTurn === 'P1' ? hud.p1Arsenal : hud.p2Arsenal;
  const p1Pct = Math.max(0, Math.round((hud.p1TowerHp / hud.maxTowerHp) * 100));
  const p2Pct = Math.max(0, Math.round((hud.p2TowerHp / hud.maxTowerHp) * 100));

  const winnerLabel = (() => {
    if (!hud.winner) return '';
    if (hud.playMode === 'bot') {
      return hud.winner === 'P1' ? 'Anda Menang!' : 'Bot Menang!';
    }
    if (hud.playMode === 'online') {
      return hud.winner === hud.localRole ? 'Anda Menang!' : 'Lawan Menang!';
    }
    return hud.winner === 'P1' ? 'Pemain 1 Menang!' : 'Pemain 2 Menang!';
  })();

  const windAbs = Math.abs(hud.wind).toFixed(1);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
      {/* Interactive 2D Physics Arena Canvas */}
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none cursor-grab active:cursor-grabbing"
      />

      {/* Top Gameplay HUD */}
      {hud.phase !== 'TITLE_MENU' && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 sm:p-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-slate-900/92 px-3 py-2.5 shadow-lg backdrop-blur-md sm:px-5">
            {/* P1 Tower HP */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400">
                <Home className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-xs font-semibold">
                  <span className="truncate text-blue-300">
                    {hud.playMode === 'bot' ? 'Rumah Anda (P1)' : 'Rumah P1'}
                  </span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {hud.p1TowerHp}/{hud.maxTowerHp}
                  </span>
                </div>
                <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-[width] duration-200"
                    style={{ width: `${p1Pct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Center Turn & Wind */}
            <div className="flex shrink-0 flex-col items-center px-2 text-center sm:px-4">
              <div className="flex items-center gap-2 text-sm font-bold tracking-tight text-white">
                <span
                  className={
                    hud.activeTurn === 'P1' ? 'text-blue-400' : 'text-red-400'
                  }
                >
                  {hud.statusBanner}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
                <span>Giliran #{hud.turnCount}</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <Wind className="h-3.5 w-3.5" />
                  {hud.wind === 0 ? (
                    'Tenang'
                  ) : (
                    <>
                      {hud.wind > 0 ? (
                        <ArrowRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowLeft className="h-3.5 w-3.5" />
                      )}
                      {windAbs}
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* P2 Tower HP */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-xs font-semibold">
                  <span className="font-mono tabular-nums text-slate-200">
                    {hud.p2TowerHp}/{hud.maxTowerHp}
                  </span>
                  <span className="truncate text-red-300">
                    {hud.playMode === 'bot' ? 'Rumah Bot (P2)' : 'Rumah P2'}
                  </span>
                </div>
                <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="ml-auto h-full rounded-full bg-red-500 transition-[width] duration-200"
                    style={{ width: `${p2Pct}%` }}
                  />
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600/20 text-red-400">
                <Home className="h-4 w-4" />
              </div>
            </div>

            {/* Utility Actions */}
            <div className="pointer-events-auto hidden items-center gap-2 border-l border-slate-700/80 pl-3 md:flex">
              <button
                type="button"
                onClick={() => engineRef.current?.toggleOverview()}
                className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  hud.overviewMode
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                <Eye className="h-4 w-4" />
                {hud.overviewMode ? 'Fokus Ketapel' : 'Lihat Arena'}
              </button>
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={muted ? 'Nyalakan suara' : 'Matikan suara'}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors shrink-0"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={handleBackToMenu}
                className="inline-flex h-10 items-center rounded-lg bg-slate-800 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0 transition-colors"
              >
                Menu
              </button>
            </div>
          </div>

          {/* Mobile compact controls */}
          <div className="pointer-events-auto mt-2 flex justify-end gap-2 md:hidden">
            <button
              type="button"
              onClick={() => engineRef.current?.toggleOverview()}
              className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap shrink-0 ${
                hud.overviewMode
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-900/90 text-slate-200 border border-slate-700'
              }`}
            >
              <Eye className="h-4 w-4" />
              {hud.overviewMode ? 'Fokus' : 'Arena'}
            </button>
            <button
              type="button"
              onClick={handleToggleMute}
              aria-label={muted ? 'Nyalakan suara' : 'Matikan suara'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/90 text-slate-200"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleBackToMenu}
              className="inline-flex h-10 items-center rounded-lg border border-slate-700 bg-slate-900/90 px-3 text-xs font-semibold text-slate-200"
            >
              Menu
            </button>
          </div>
        </header>
      )}

      {/* Bottom Bomb Arsenal & Instruction Bar */}
      {hud.phase === 'PLAYING' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 sm:p-4">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-2">
            {hud.canSplitMidAir && (
              <div className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow-lg">
                Klik layar atau tekan Spasi sekarang untuk memecah bom menjadi 3!
              </div>
            )}

            {isLocalTurnToAim ? (
              <div className="pointer-events-auto flex w-full flex-col items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/92 p-2.5 shadow-xl backdrop-blur-md sm:flex-row sm:justify-between sm:px-4">
                <div className="flex items-center gap-2">
                  {(['standard', 'cluster', 'heavy'] as BombType[]).map((type) => {
                    const spec = BOMB_SPECS[type];
                    const count = activeArsenal[type];
                    const disabled = count === 0;
                    const selected = hud.selectedBomb === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={disabled}
                        onClick={() => engineRef.current?.selectBomb(type)}
                        title={spec.description}
                        className={`inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                          selected
                            ? 'bg-amber-500 text-slate-950'
                            : disabled
                            ? 'bg-slate-800/50 text-slate-500 cursor-not-allowed'
                            : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                        }`}
                      >
                        <Flame className="h-3.5 w-3.5" />
                        <span>{spec.shortLabel}</span>
                        <span className="font-mono tabular-nums opacity-80">
                          {count < 0 ? '∞' : `x${count}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-center text-xs text-slate-300 sm:text-right">
                  {BOMB_SPECS[hud.selectedBomb].description} Tarik ketapel untuk melempar.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/85 px-4 py-2 text-xs font-medium text-slate-300 backdrop-blur-md">
                {hud.turnPhase === 'FLYING'
                  ? 'Bom sedang meluncur...'
                  : hud.turnPhase === 'SETTLING'
                  ? 'Menghitung kerusakan tembok & tower...'
                  : hud.statusBanner}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Title & Lobby Overlay */}
      {hud.phase === 'TITLE_MENU' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700/80 bg-slate-900/95 p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  Benteng Bom
                </h1>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                  Duel ketapel bergantian. Lempar bom untuk meruntuhkan tembok pelindung dan hancurkan rumah tower lawan.
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={muted ? 'Nyalakan suara' : 'Matikan suara'}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>

            {menuView === 'main' && (
              <div className="mt-6 space-y-5">
                {/* Fortress Preset Picker */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    Formasi Benteng
                  </label>
                  <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-950/70 p-1.5">
                    {FORTRESS_PRESETS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setPreset(item.id)}
                        className={`h-10 rounded-lg px-2 text-xs font-semibold whitespace-nowrap truncate transition-colors ${
                          preset === item.id
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {FORTRESS_PRESETS.find((f) => f.id === preset)?.summary}
                  </p>
                </div>

                {/* Primary Mode Selection */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleStartLocal}
                    className="flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-500 whitespace-nowrap transition-colors"
                  >
                    <Users className="h-4 w-4" />
                    Main Berdua (1 Layar)
                  </button>
                  <button
                    type="button"
                    onClick={handleStartBot}
                    className="flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-bold text-white hover:bg-slate-700 whitespace-nowrap transition-colors"
                  >
                    <Bot className="h-4 w-4" />
                    Lawan Bot AI
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setLobbyError('');
                    setMenuView('online');
                  }}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 text-sm font-bold text-amber-300 hover:bg-amber-500/20 whitespace-nowrap transition-colors"
                >
                  <Swords className="h-4 w-4" />
                  Mabar Online (Kode Room)
                </button>

                {!isLocalFile && (
                  <div>
                    <button
                      type="button"
                      disabled={downloadingHtml}
                      onClick={handleDownloadFullHtml}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/70 px-4 text-xs font-semibold text-slate-200 hover:bg-slate-800 whitespace-nowrap transition-colors disabled:opacity-60"
                    >
                      <Download className="h-4 w-4" />
                      {downloadingHtml
                        ? 'Menyiapkan benteng-bom.html...'
                        : 'Unduh Full HTML (benteng-bom.html)'}
                    </button>
                    {downloadError && (
                      <p className="mt-1.5 text-center text-xs text-red-400">
                        {downloadError}
                      </p>
                    )}
                  </div>
                )}

                {/* Concise Rules */}
                <div className="grid grid-cols-3 gap-3 border-t border-slate-800 pt-4 text-xs text-slate-400">
                  <div>
                    <span className="block font-semibold text-slate-200">1. Tarik & Bidik</span>
                    Tarik ketapel ke belakang untuk mengatur sudut dan tenaga.
                  </div>
                  <div>
                    <span className="block font-semibold text-slate-200">2. Saling Bergantian</span>
                    Pemain 1 dan Pemain 2 melempar bom secara bergiliran.
                  </div>
                  <div>
                    <span className="block font-semibold text-slate-200">3. Hancurkan Rumah</span>
                    Jika darah rumah tower lawan habis (0), Anda menang.
                  </div>
                </div>
              </div>
            )}

            {menuView === 'online' && (
              <div className="mt-6 space-y-4">
                <button
                  type="button"
                  onClick={() => setMenuView('main')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Kembali
                </button>

                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={handleCreateRoom}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors"
                  >
                    <Shield className="h-4 w-4" />
                    Buat Room Baru
                  </button>

                  <div className="border-t border-slate-800 pt-4">
                    <label className="block text-xs font-semibold text-slate-300">
                      Atau Gabung Room Teman
                    </label>
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        value={joinInput}
                        onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                        placeholder="KODE6X"
                        className="h-11 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 font-mono text-sm uppercase tracking-widest text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleJoinRoom}
                        className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white hover:bg-blue-500 whitespace-nowrap"
                      >
                        Gabung
                      </button>
                    </div>
                  </div>
                </div>

                {lobbyError && (
                  <p className="text-xs font-medium text-red-400">{lobbyError}</p>
                )}
              </div>
            )}

            {(menuView === 'room_host' || menuView === 'room_guest') && (
              <div className="mt-6 space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200">
                    {menuView === 'room_host' ? 'Host Room (Pemain 1)' : 'Tamu Room (Pemain 2)'}
                  </span>
                  <button
                    type="button"
                    onClick={handleLeaveOnlineLobby}
                    className="text-xs font-semibold text-slate-400 hover:text-white"
                  >
                    Keluar Room
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950 px-4 py-3">
                  <div>
                    <span className="block text-xs text-slate-400">Kode Room</span>
                    <span className="font-mono text-2xl font-bold tracking-widest text-amber-400">
                      {roomCode}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Tersalin' : 'Salin'}
                  </button>
                </div>

                <p className="text-xs text-slate-300">
                  {roomReady
                    ? 'Teman sudah bergabung! Pertandingan siap dimulai.'
                    : 'Bagikan kode di atas ke teman Anda, lalu tunggu hingga bergabung.'}
                </p>

                {lobbyError && (
                  <p className="text-xs font-medium text-red-400">{lobbyError}</p>
                )}

                {menuView === 'room_host' && (
                  <button
                    type="button"
                    disabled={!roomReady}
                    onClick={() => mpRef.current?.startMatch(preset)}
                    className={`flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                      roomReady
                        ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    Mulai Pertandingan
                  </button>
                )}

                {menuView === 'room_guest' && (
                  <div className="rounded-xl bg-slate-800/70 px-4 py-3 text-center text-xs font-medium text-slate-300">
                    Menunggu Pemain 1 memulai pertandingan...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Game Over Modal */}
      {hud.phase === 'GAME_OVER' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
              <Trophy className="h-7 w-7" />
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold text-white">
              {winnerLabel}
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Rumah tower lawan telah hancur rata dengan tanah.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-950/80 p-4 text-left text-xs">
              <div>
                <span className="text-slate-400">Lemparan P1</span>
                <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-blue-400">
                  {hud.p1Shots}x · {hud.p2BlocksBroken} blok hancur
                </div>
              </div>
              <div>
                <span className="text-slate-400">Lemparan P2</span>
                <div className="mt-0.5 font-mono text-base font-bold tabular-nums text-red-400">
                  {hud.p2Shots}x · {hud.p1BlocksBroken} blok hancur
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleRematch}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
              >
                <RotateCcw className="h-4 w-4" />
                Main Lagi
              </button>
              <button
                type="button"
                onClick={handleBackToMenu}
                className="flex h-11 flex-1 items-center justify-center rounded-xl bg-slate-800 px-4 text-sm font-semibold text-slate-200 hover:bg-slate-700 whitespace-nowrap"
              >
                Menu Utama
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
