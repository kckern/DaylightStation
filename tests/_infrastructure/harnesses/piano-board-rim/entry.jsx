/**
 * Board-rim geometry harness — the three addressed-board games (Chess, Checkers,
 * Connect Four) mounted with their REAL frame, stage, rails, board and staff-card
 * components and their real stylesheets, on a 1280×800 design canvas with a
 * stand-in for the kiosk header.
 *
 * No learner, MIDI, session or API: this only exists to answer "how big is a
 * staff card, and what does each piece of chrome cost it". Scenario knobs come
 * from the query string so run.mjs can sweep them:
 *
 *   game=chess|checkers|connect-four
 *   header=<px>        kiosk header height (0 = hidden)
 *   kb=<css length>    keyboard dock height (0 = hidden)
 *   rail=<css length>  side rail width (--pg-rail-w)
 *   boardMax=<css>     board ceiling (--pg-board-max)
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClefGlyph } from '@/modules/MusicNotation/renderers/staffGlyphs.jsx';
import BoardGameFrame from '@/modules/Piano/game-platform/host/BoardGameFrame.jsx';
import { GameRail, GameSlot, GameStatusBar } from '@/modules/Piano/game-platform/chrome/index.js';
import ChessBoard from '@/modules/Chess/ChessBoard.jsx';
import AddressRail from '@/modules/Piano/game-platform/families/addressed-board/AddressRail.jsx';
import { StaffClefLabel, StaffNoteLabel } from '@/modules/Piano/game-platform/families/addressed-board/StaffNoteLabel.jsx';
import { BOARD_LAYOUTS } from '@/modules/Piano/game-platform/families/addressed-board/contracts.js';
import { PianoFullscreenProvider } from '@/modules/Piano/PianoKiosk/PianoFullscreenContext.jsx';
import { rimAxisClef, rimStaffExtent } from '@/modules/MusicNotation/renderers/RimStaffRenderer.jsx';
import ChordNamePanel from '@/modules/Piano/components/ChordNamePanel.jsx';
import CurrentChordStaff from '@/modules/Piano/components/CurrentChordStaff.jsx';
import '@/modules/Piano/components/ActionStaff.scss';
import '@/modules/Piano/PianoChessGame/PianoChessGame.scss';
import '@/modules/Piano/PianoCheckers/PianoCheckers.scss';
import '@/modules/Piano/PianoConnectFour/PianoConnectFour.scss';

const q = new URLSearchParams(window.location.search);
const game = q.get('game') || 'chess';
const header = Number(q.get('header') ?? 59);
const kb = q.get('kb');
const rail = q.get('rail');
const boardMax = q.get('boardMax');
// The stage's rail TRACK, which is `minmax(--pg-rail-w, 0.28fr)`: lowering
// --pg-rail-w alone only lowers the floor, and the 0.28fr share still wins.
const railTrack = q.get('railTrack');
// Checkers' rim thickness token (`--ck-rank-rail`, also its file rail).
const ckRail = q.get('ckRail');
// Board-game full screen, through the real provider: mounting a board game
// inside it claims full screen by default, the header stand-in goes, and the
// games style themselves off the host class. Without it the games are windowed.
const fullscreen = q.get('fullscreen') === '1';
const fullscreenStore = { getItem: () => null, setItem() {}, removeItem() {} };

// The grand-staff default scheme both board games ship with (staffAddress.js),
// or (shape=dyad) the two-note shapes the ladder deals next.
const dyads = q.get('shape') === 'dyad';
const TREBLE = dyads
  ? [[60, 67], [62, 69], [64, 71], [65, 72], [67, 74], [69, 76], [71, 77], [72, 79]]
  : [60, 62, 64, 65, 67, 69, 71, 72];
const BASS = dyads
  ? [[41, 48], [43, 50], [45, 52], [47, 53], [48, 55], [50, 57], [52, 59], [53, 59]]
  : [47, 48, 50, 52, 53, 55, 57, 59];
const cardKey = (token) => [token].flat().join('-');
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const noNotes = new Map();

const overrides = [
  rail && `.harness .piano-game-host { --pg-rail-w: ${rail}; }`,
  boardMax && `.harness .piano-game-host.piano-game-host { --pg-board-max: ${boardMax}; }`,
  kb && kb !== '0' && `.harness .piano-game-host { --pg-keyboard-h: ${kb}; }
    .harness .piano-chess__instrument .piano-keyboard { height: ${kb}; }`,
  kb === '0' && '.harness .piano-game-host__instrument { display: none; }',
  railTrack && `.harness .instrument-board-stage { --rail-width: ${railTrack}; }`,
  railTrack === '0px' && '.harness .instrument-board-stage__rail { display: none; }',
  ckRail && `.harness .piano-checkers.piano-checkers { --ck-rank-rail: ${ckRail}; }`,
].filter(Boolean).join('\n');

function Rail({ label }) {
  return (
    <GameRail label={label}>
      <GameSlot label="Slot">Rail content</GameSlot>
    </GameRail>
  );
}

// Chess's real right rail, down to the "Playing" card: the clock, identity and
// opponent blocks are stand-ins of their measured height on the kiosk, and the
// live staff card is the real component in the real rail.
function ChessHandsRail() {
  return (
    <GameRail label="Your hands" className="piano-chess__rail piano-chess__rail--chords">
      <GameSlot label="Clock"><div style={{ height: 64 }}>THEM 7:46 · YOU 39:13</div></GameSlot>
      <GameSlot label="Player"><div style={{ height: 40 }}>Player · Yours (White)</div></GameSlot>
      <GameSlot label="Opponent"><div style={{ height: 170 }}>Opponent card</div></GameSlot>
      <h2 className="pg-slot__label">Playing</h2>
      <ChordNamePanel midiNotes={[]} />
      <div className="piano-chess__staff-card action-staff">
        <CurrentChordStaff activeNotes={noNotes} />
      </div>
      <div className="piano-chess__captured">
        <p className="piano-chess__captured-none">No pieces taken yet</p>
      </div>
    </GameRail>
  );
}

function Chess() {
  const fileExtent = rimStaffExtent(TREBLE, { clef: false });
  const rankExtent = rimStaffExtent(BASS);
  return (
    <BoardGameFrame
      gameId="chess"
      className="piano-chess piano-chess--reading"
      stageClassName="piano-chess__stage"
      instrumentClassName="piano-chess__instrument"
      instrument={{ activeNotes: noNotes, startNote: 36, endNote: 84, showLabels: true }}
      leftRail={<Rail label="Move controls" />}
      rightRail={<ChessHandsRail />}
      status={<GameStatusBar>Play a piece&apos;s two notes twice to pick it up.</GameStatusBar>}
      primary={(
        <ChessBoard
          fen={START_FEN}
          status={{}}
          orientation="white"
          fileLabels={TREBLE.map((token) => (
            <StaffNoteLabel key={cardKey(token)} midi={token} extent={fileExtent} clef={false} />
          ))}
          rankLabels={BASS.map((token) => <StaffNoteLabel key={cardKey(token)} midi={token} extent={rankExtent} />)}
          corner={<StaffClefLabel clef={rimAxisClef(TREBLE)} extent={fileExtent} />}
        />
      )}
    />
  );
}

function CheckersBoardSkeleton() {
  return (
    <div className="checkers-board" role="grid">
      {Array.from({ length: 64 }, (_, cell) => {
        const playable = (Math.floor(cell / 8) + (cell % 8)) % 2 === 1;
        const row = Math.floor(cell / 8);
        const piece = playable && (row < 3 || row > 4);
        return (
          <div key={cell} className={`checkers-board__cell ${playable ? 'is-playable' : 'is-light'}`}>
            {piece && <span className={`checkers-board__piece checkers-board__piece--${row < 3 ? 'opponent' : 'player'}`} />}
          </div>
        );
      })}
    </div>
  );
}

function Checkers() {
  return (
    <BoardGameFrame
      gameId="checkers"
      className="piano-checkers"
      instrument={{ activeNotes: noNotes, startNote: 36, endNote: 84, showLabels: true, onNoteOn() {}, onNoteOff() {} }}
      layout={BOARD_LAYOUTS.SINGLE}
      primary={(
        <div className="checkers-stage">
          <AddressRail addresses={TREBLE.map((midi) => ({ midi }))} orientation="horizontal" className="checkers-stage__file-rail" />
          <AddressRail addresses={[...BASS].reverse().map((midi) => ({ midi }))} orientation="vertical" className="checkers-stage__rank-rail" />
          <CheckersBoardSkeleton />
        </div>
      )}
      leftRail={<Rail label="Opponent" />}
      rightRail={<Rail label="Controls" />}
      status={<GameStatusBar>Your move.</GameStatusBar>}
    />
  );
}

function ConnectFour() {
  return (
    <BoardGameFrame
      gameId="connect-four"
      className="piano-connect-four"
      instrument={{ activeNotes: noNotes, startNote: 48, endNote: 84, showLabels: true, onNoteOn() {}, onNoteOff() {} }}
      layout={BOARD_LAYOUTS.SINGLE}
      primary={(
        <div className="connect-four-stage">
          <AddressRail addresses={TREBLE.slice(0, 7).map((midi) => ({ midi }))} orientation="horizontal" className="connect-four-stage__rail" />
          <div className="connect-four-board pg-board">
            {Array.from({ length: 42 }, (_, cell) => (
              <div key={cell} className="connect-four-board__cell">
                <span className="connect-four-board__disc connect-four-board__disc--empty" />
              </div>
            ))}
          </div>
        </div>
      )}
      leftRail={<Rail label="Opponent" />}
      rightRail={<Rail label="Controls" />}
      status={<GameStatusBar>Your move.</GameStatusBar>}
    />
  );
}

/* ---- mock: the same card boxes, drawn over the axis's range only ---------- */

// Today's chess card boxes on the 1280×800 kiosk, as measured by run.mjs.
const PITCH = 62.55;
const FILE = { w: 59.8, h: 66.9, strip: 90.4 };
const RANK = { w: 74.4, h: 59.8 };

// Staff position of a natural note on a clef: 0 = bottom line, one per step.
const LETTER_STEP = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const diatonic = (midi) => (Math.floor(midi / 12) - 1) * 7 + LETTER_STEP[midi % 12];
const positionOn = (midi, clef) => diatonic(midi) - diatonic(clef === 'bass' ? 43 : 64);
// The span every card on one axis has to show: all five lines, every note the
// axis names, and half a space of air at each end. One span per axis, so every
// card on a strip is drawn at the same scale.
const axisSpan = (notes, clef) => {
  const positions = notes.map((midi) => positionOn(midi, clef));
  return [Math.min(0, ...positions) - 1, Math.max(8, ...positions) + 1];
};

function RimCard({ midi, clef, w, h, span, withClef }) {
  const [lo, hi] = span;
  const spaces = (hi - lo) / 2;
  const s = Math.min(h / spaces, w / (withClef ? 4.6 : 2.4));
  const top = (h - spaces * s) / 2;
  const y = (pos) => top + (hi - pos) * (s / 2);
  const pos = positionOn(midi, clef);
  const noteX = withClef ? w - 1.35 * s : w / 2;
  const ledgers = [];
  for (let p = -2; p >= pos; p -= 2) ledgers.push(p);
  for (let p = 10; p <= pos; p += 2) ledgers.push(p);
  const clefRef = useRef(null);
  const [clefShift, setClefShift] = useState(0);
  useLayoutEffect(() => {
    if (!withClef || !clefRef.current) return;
    setClefShift(0.3 * s - clefRef.current.getBBox().x);
  }, [withClef, s]);
  return (
    <div
      className="chess-staff-label action-staff"
      style={{ width: w, height: h, aspectRatio: 'auto', maxHeight: 'none', margin: 0, position: 'relative' }}
    >
      <svg width={w} height={h} style={{ position: 'absolute', inset: 0 }}>
        {[0, 2, 4, 6, 8].map((p) => <line key={p} x1="0" x2={w} y1={y(p)} y2={y(p)} stroke="#000" strokeWidth="1" />)}
        {withClef && (
          <g ref={clefRef} transform={`translate(${clefShift} 0)`}>
            <ClefGlyph clef={clef} lineSpacing={s} bottomLineY={y(0)} />
          </g>
        )}
        {ledgers.map((p) => <line key={p} x1={noteX - s} x2={noteX + s} y1={y(p)} y2={y(p)} stroke="#000" strokeWidth="1" />)}
        <ellipse cx={noteX} cy={y(pos)} rx={0.643 * s} ry={0.464 * s} transform={`rotate(-12 ${noteX} ${y(pos)})`} />
      </svg>
    </div>
  );
}

function ClefCell({ clef, h, span }) {
  const [lo, hi] = span;
  const s = h / ((hi - lo) / 2);
  const y = (pos) => (hi - pos) * (s / 2);
  return (
    <svg width="74" height={h} style={{ flex: 'none' }}>
      {[0, 2, 4, 6, 8].map((p) => <line key={p} x1="30" x2="74" y1={y(p)} y2={y(p)} stroke="#9a9aa6" strokeWidth="1" />)}
      <g transform="translate(34 0)"><ClefGlyph clef={clef} lineSpacing={s} bottomLineY={y(0)} /></g>
    </svg>
  );
}

function Mock() {
  const trebleSpan = axisSpan(TREBLE, 'treble');
  const bassSpan = axisSpan(BASS, 'bass');
  const RANK_SAMPLE = [59, 57, 55, 53];
  const spacing = (w, h, span, withClef) => Math.min(h / ((span[1] - span[0]) / 2), w / (withClef ? 4.6 : 2.4)).toFixed(1);
  const today = (w, h) => (14 * Math.min(w / 100, h / 112)).toFixed(1);
  const rows = [
    {
      title: 'Today', files: `${today(FILE.w, FILE.h)}px`, ranks: `${today(RANK.w, RANK.h)}px`,
      file: (midi) => <div key={midi} style={{ width: FILE.w, height: FILE.h }}><StaffNoteLabel midi={midi} /></div>,
      rank: (midi) => <div key={midi} style={{ width: RANK.w, height: RANK.h }}><StaffNoteLabel midi={midi} /></div>,
      clefCell: null, fileH: FILE.h,
    },
    {
      title: 'Range-cropped, clef on every card',
      files: `${spacing(FILE.w, FILE.strip, trebleSpan, true)}px`, ranks: `${spacing(RANK.w, RANK.h, bassSpan, true)}px`,
      file: (midi) => <RimCard key={midi} midi={midi} clef="treble" w={FILE.w} h={FILE.strip} span={trebleSpan} withClef />,
      rank: (midi) => <RimCard key={midi} midi={midi} clef="bass" w={RANK.w} h={RANK.h} span={bassSpan} withClef />,
      clefCell: null, fileH: FILE.strip,
    },
    {
      title: 'Range-cropped, one clef per strip',
      files: `${spacing(FILE.w, FILE.strip, trebleSpan, false)}px`, ranks: `${spacing(RANK.w, RANK.h, bassSpan, true)}px (ranks keep theirs)`,
      file: (midi) => <RimCard key={midi} midi={midi} clef="treble" w={FILE.w} h={FILE.strip} span={trebleSpan} />,
      rank: (midi) => <RimCard key={midi} midi={midi} clef="bass" w={RANK.w} h={RANK.h} span={bassSpan} withClef />,
      clefCell: <ClefCell clef="treble" h={FILE.strip} span={trebleSpan} />, fileH: FILE.strip,
    },
  ];
  return (
    <div className="mock" style={{ width: 1280, padding: 24, background: '#16161b', color: '#f1f1f4', display: 'grid', gap: 28 }}>
      {rows.map((row) => (
        <section key={row.title} style={{ display: 'grid', gridTemplateColumns: '170px 1fr auto', gap: 24, alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{row.title}</div>
            <div style={{ color: '#9a9aa6', marginTop: 6 }}>Line spacing<br />files {row.files}<br />ranks {row.ranks}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', height: FILE.strip }}>
            <div style={{ width: 74, flex: 'none' }}>{row.clefCell}</div>
            {TREBLE.map((midi) => (
              <div key={midi} style={{ width: PITCH, display: 'grid', placeItems: 'center' }}>{row.file(midi)}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridAutoRows: PITCH, placeItems: 'center' }}>
            {RANK_SAMPLE.map((midi) => row.rank(midi))}
          </div>
        </section>
      ))}
      <span className="mock-ready" />
    </div>
  );
}

const GAMES = { chess: Chess, checkers: Checkers, 'connect-four': ConnectFour, mock: Mock };
const Game = GAMES[game];

function Harness() {
  if (game === 'mock') return <Mock />;
  return (
    <div
      className="harness"
      style={{ width: 1280, height: 800, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: '#16161b' }}
    >
      <style>{overrides}</style>
      {header > 0 && !fullscreen && (
        <header
          className="harness-header"
          style={{ flex: `0 0 ${header}px`, boxSizing: 'border-box', background: '#1f1f26', borderBottom: '1px solid #34343f' }}
        />
      )}
      <div
        className="piano-game-fullscreen"
        style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        {fullscreen
          ? <PianoFullscreenProvider storage={fullscreenStore}><Game /></PianoFullscreenProvider>
          : <Game />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
window.__harnessMounted = true;
