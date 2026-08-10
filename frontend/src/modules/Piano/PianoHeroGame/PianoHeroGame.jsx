import { useEffect, useMemo, useState } from 'react';
import { DaylightAPIText } from '../../../lib/api.mjs';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { parseMusicXml } from '../../MusicNotation/parseMusicXml.js';
import { getNoteHue, getNotePosition, getNoteWidth, computeKeyboardRange } from '../noteUtils.js';
import { PianoKeyboard } from '../components/PianoKeyboard.jsx';
import { usePianoKioskConfig } from '../PianoKiosk/PianoConfig.jsx';
import { usePianoMidi, usePianoMidiNotes } from '../PianoKiosk/PianoMidiContext.jsx';
import PianoEmpty from '../PianoKiosk/PianoEmpty.jsx';
import { SkeletonPoster, SkeletonStage } from '../PianoKiosk/Skeleton.jsx';
import usePianoList from '../PianoKiosk/usePianoList.js';
import { balancedGrid } from '../PianoKiosk/tileGridLayout.js';
import { resolveScoreGroups, groupSlug, groupIndexBySlug } from '../PianoKiosk/modes/SheetMusic/scoreGroups.js';
import { prettyTitle } from '../PianoKiosk/modes/SheetMusic/scoreTitle.js';
import useMetronomeClick from '../PianoKiosk/modes/SheetMusic/useMetronomeClick.js';
import { TempoSheet } from '../PianoKiosk/producer/TempoSheet.jsx';
import { buildHeroChart, clampHeroTempo, heroAccuracy, retimeHeroChart } from './heroChart.js';
import { heroMetronomePlan } from './heroMetronome.js';
import { heroThresholdState } from './heroThreshold.js';
import { usePianoHeroGame } from './usePianoHeroGame.js';
import './PianoHeroGame.scss';

const NOTATION_RE = /\.(musicxml|mxl)$/i;

const listPath = (ref) => {
  const raw = String(ref || '').trim();
  const colon = raw.indexOf(':');
  const source = colon > 0 ? raw.slice(0, colon) : 'plex';
  const id = colon > 0 ? raw.slice(colon + 1) : raw;
  return raw ? `api/v1/list/${source}/${id}` : null;
};

const localMediaId = (contentId) => String(contentId || '').replace(/^[a-z]+:/i, '');

/** MusicXML-only first source for Piano Hero. Studio takes can join this picker later. */
/**
 * @param {string|null} [subRoute] - the collection tab named in the URL, so a
 *   reload or a shared link opens on the same tab.
 * @param {(slug:string)=>void} [onSubRoute] - report a tab change up to the router.
 */
export function HeroSongPicker({ sheetmusic, onSelect, subRoute = null, onSubRoute }) {
  const groups = useMemo(() => resolveScoreGroups(sheetmusic).map((group) => ({
    ...group,
    listPath: listPath(group.ref),
  })), [sheetmusic]);
  // The URL is the source of truth for which tab is open. An unknown slug falls
  // back to the first collection rather than a dead end (see groupIndexBySlug).
  const tab = groupIndexBySlug(groups, subRoute);
  const active = groups[Math.min(tab, Math.max(0, groups.length - 1))];
  const { data, error } = usePianoList(active?.listPath || null);
  const songs = (data || []).filter((item) => NOTATION_RE.test(String(item?.id || '')));
  const grid = balancedGrid(songs.length || 1, { minCols: 5 });

  return (
    <section className="piano-hero-picker">
      {groups.length > 1 && (
        <div className="piano-course-tabs" role="tablist" aria-label="Piano Hero score collections">
          {groups.map((group, index) => (
            <button
              key={group.label ?? index}
              type="button"
              role="tab"
              aria-selected={tab === index}
              className={`piano-course-tab${tab === index ? ' is-active' : ''}`}
              onClick={() => onSubRoute?.(groupSlug(group, index))}
            >
              {group.label || 'Scores'}
            </button>
          ))}
        </div>
      )}
      {data === null && <SkeletonPoster count={8} />}
      {data !== null && songs.length === 0 && (
        <PianoEmpty message={error || 'No MusicXML scores were found in this collection.'} />
      )}
      {songs.length > 0 && (
        <ul
          className="piano-hero-picker__grid"
          style={{ '--hero-cols': grid.cols, '--hero-rows': grid.rows }}
        >
          {songs.map((song) => {
            const title = prettyTitle(song.title || localMediaId(song.id).split('/').pop()?.replace(/\.(musicxml|mxl)$/i, ''));
            const cover = song.thumbnail || song.image;
            return (
              <li key={song.id}>
                <button type="button" onClick={() => onSelect({ ...song, title })} title={title}>
                  {cover ? <img src={cover} alt="" /> : <span className="piano-hero-picker__note">♪</span>}
                  <strong>{title}</strong>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function HeroHighway({ chart, targets, elapsedMs, fallDurationMs, metronomeOn = false, playing = false }) {
  const range = useMemo(() => computeKeyboardRange([chart.startNote, chart.endNote]), [chart.startNote, chart.endNote]);
  const threshold = heroThresholdState({
    targets,
    elapsedMs,
    leadInMs: chart.leadInMs,
    bpm: chart.tempo,
    beatsPerBar: chart.timeSig?.beats,
    pulseBeat: metronomeOn && playing,
  });
  const visible = targets.filter((target) => {
    const age = elapsedMs - target.targetTimeMs;
    const resolutionAge = target.resolvedAt === null ? 0 : elapsedMs - target.resolvedAt;
    if (target.state === 'hit') return resolutionAge < 450;
    if (target.state === 'missed') return resolutionAge < 750;
    return age > -fallDurationMs - 100 && age < 900;
  });
  return (
    <div className="piano-hero-highway">
      <div className="piano-hero-highway__lanes" />
      {visible.flatMap((target) => target.pitches.map((pitch) => {
        const progress = 1 - ((target.targetTimeMs - elapsedMs) / fallDurationMs);
        const top = progress * 82;
        const height = Math.max(2.5, Math.min(18, (target.durationMs / fallDurationMs) * 82));
        return (
          <div
            key={`${target.id}-${pitch}`}
            className={`piano-hero-note piano-hero-note--${target.state}${target.hitPitches.includes(pitch) ? ' is-struck' : ''}`}
            style={{
              '--x': `${getNotePosition(pitch, range.startNote, range.endNote)}%`,
              '--w': `${getNoteWidth(pitch, range.startNote, range.endNote, true)}%`,
              '--y': `${top}%`,
              '--h': `${height}%`,
              '--hue': getNoteHue(pitch, range.startNote, range.endNote),
            }}
          />
        );
      }))}
      <div className="piano-hero-highway__hit-line" data-testid="hero-hit-line">
        {threshold.beatIndex !== null && (
          <span
            key={`beat-${threshold.beatIndex}`}
            className={`piano-hero-highway__beat-flash${threshold.downbeat ? ' is-downbeat' : ''}`}
          />
        )}
        {threshold.effects.map((effect) => (
          <span
            key={effect.id}
            className={`piano-hero-highway__threshold-spark is-${effect.kind}`}
            style={{
              '--x': `${getNotePosition(effect.pitch, range.startNote, range.endNote)}%`,
              '--w': `${getNoteWidth(effect.pitch, range.startNote, range.endNote, true)}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function HeroGame({ song, chart, gameConfig, onChooseSong, onNoteOn, onNoteOff }) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-hero-game' }), []);
  const { subscribe } = usePianoMidi();
  const [metronomeOn, setMetronomeOn] = useState(() => gameConfig?.metronomeDefault !== false);
  const [tempoBpm, setTempoBpm] = useState(() => clampHeroTempo(gameConfig?.tempo ?? chart.tempo));
  const [tempoSheetOpen, setTempoSheetOpen] = useState(false);
  const activeChart = useMemo(() => retimeHeroChart(chart, tempoBpm), [chart, tempoBpm]);
  const game = usePianoHeroGame({ chart: activeChart, subscribe, config: gameConfig });
  const { activeNotes } = usePianoMidiNotes();
  const range = useMemo(() => computeKeyboardRange([activeChart.startNote, activeChart.endNote]), [activeChart.startNote, activeChart.endNote]);
  const imminent = useMemo(() => new Set(game.run.targets
    .filter((target) => target.state === 'pending' && Math.abs(target.targetTimeMs - game.elapsedMs) <= 500)
    .flatMap((target) => target.pitches)), [game.run.targets, game.elapsedMs]);
  const countdown = game.phase === 'playing' && game.elapsedMs < activeChart.leadInMs
    ? Math.ceil((activeChart.leadInMs - game.elapsedMs) / 1000)
    : null;
  const progress = activeChart.durationMs > 0 ? Math.min(100, (game.elapsedMs / activeChart.durationMs) * 100) : 0;
  const metronomePlan = heroMetronomePlan({
    elapsedMs: game.elapsedMs,
    leadInMs: activeChart.leadInMs,
    bpm: activeChart.tempo,
    beatsPerBar: activeChart.timeSig?.beats,
  });
  useMetronomeClick({
    enabled: metronomeOn && game.phase === 'playing',
    bpm: activeChart.tempo,
    startDelayMs: metronomePlan.startDelayMs,
    beatsPerBar: activeChart.timeSig?.beats,
    firstBeatIndex: metronomePlan.firstBeatIndex,
  });

  const toggleMetronome = () => {
    setMetronomeOn((on) => {
      logger.info('hero.metronome-toggled', { enabled: !on, bpm: activeChart.tempo });
      return !on;
    });
  };

  const changeTempo = (nextBpm) => {
    const next = clampHeroTempo(nextBpm);
    setTempoBpm(next);
    logger.info('hero.tempo-changed', { from: activeChart.tempo, to: next, scoreTempo: chart.tempo });
  };

  return (
    <div className="piano-hero-game">
      <header className="piano-hero-game__hud">
        <button type="button" className="piano-hero-game__songs" onClick={onChooseSong}>Songs</button>
        <div className="piano-hero-game__title">
          <strong>{song.title}</strong>
          <button
            type="button"
            className="piano-hero-game__tempo"
            aria-label="Tempo"
            disabled={game.phase === 'playing'}
            title={game.phase === 'playing' ? 'Tempo can be changed between runs' : 'Change tempo'}
            onClick={() => setTempoSheetOpen(true)}
          >{activeChart.tempo} BPM</button>
        </div>
        <button
          type="button"
          className={`piano-hero-game__metronome${metronomeOn ? ' is-on' : ''}`}
          aria-label="Metronome"
          aria-pressed={metronomeOn}
          onClick={toggleMetronome}
        >
          <span aria-hidden="true">♩</span>
          Click {metronomeOn ? 'on' : 'off'}
        </button>
        <div className="piano-hero-game__score">
          <strong>{game.run.score.points.toLocaleString()}</strong>
          <span>{game.run.score.combo > 1 ? `${game.run.score.combo} note streak` : 'Score'}</span>
        </div>
        <div className="piano-hero-game__progress"><span style={{ width: `${progress}%` }} /></div>
      </header>

      <HeroHighway
        chart={activeChart}
        targets={game.run.targets}
        elapsedMs={game.elapsedMs}
        fallDurationMs={game.timing.fallDurationMs}
        metronomeOn={metronomeOn}
        playing={game.phase === 'playing'}
      />

      <div className="piano-hero-game__keyboard">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={range.startNote}
          endNote={range.endNote}
          targetNotes={imminent.size ? imminent : null}
          onNoteOn={onNoteOn}
          onNoteOff={onNoteOff}
        />
      </div>

      {game.phase === 'ready' && (
        <div className="piano-hero-overlay">
          <h2>{song.title}</h2>
          <p>{activeChart.targets.length} note events · {activeChart.tempo} BPM</p>
          <button type="button" onClick={game.start}>Play</button>
        </div>
      )}
      {countdown && <div className="piano-hero-countdown">{countdown}</div>}
      {game.phase === 'complete' && (
        <div className="piano-hero-overlay piano-hero-overlay--complete">
          <p>Song complete</p>
          <h2>{heroAccuracy(game.run)}%</h2>
          <div className="piano-hero-results">
            <span><strong>{game.run.score.perfect}</strong> Perfect</span>
            <span><strong>{game.run.score.good}</strong> Good</span>
            <span><strong>{game.run.score.misses}</strong> Missed</span>
            <span><strong>{game.run.score.maxCombo}</strong> Best streak</span>
          </div>
          <div className="piano-hero-overlay__actions">
            <button type="button" onClick={game.start}>Play again</button>
            <button type="button" className="is-secondary" onClick={onChooseSong}>Choose a song</button>
          </div>
        </div>
      )}
      {tempoSheetOpen && (
        <TempoSheet
          bpm={activeChart.tempo}
          onBpm={changeTempo}
          onClose={() => setTempoSheetOpen(false)}
        />
      )}
    </div>
  );
}

/** MusicXML-backed falling-note game. */
export function PianoHeroGame({ gameConfig, onNoteOn, onNoteOff, subRoute = null, onSubRoute }) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-hero-game' }), []);
  const { config } = usePianoKioskConfig();
  const [song, setSong] = useState(null);
  const [chart, setChart] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!song) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setChart(null);
    (async () => {
      try {
        const xml = await DaylightAPIText(`api/v1/proxy/media/stream/${encodeURIComponent(localMediaId(song.id))}`);
        const parsed = parseMusicXml(xml);
        const next = buildHeroChart(parsed, {
          leadInMs: gameConfig?.leadInMs,
          fallDurationMs: gameConfig?.fallDurationMs,
        });
        if (!next.targets.length) throw new Error('This score has no playable notes.');
        if (!cancelled) setChart(next);
        logger.info('hero.song-loaded', { id: song.id, targets: next.targets.length, tempo: next.tempo });
      } catch (err) {
        logger.warn('hero.song-load-failed', { id: song.id, error: err.message });
        if (!cancelled) setError(err.message || 'Could not load this score.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [song, gameConfig?.leadInMs, gameConfig?.fallDurationMs, logger]);

  if (!song) return <HeroSongPicker sheetmusic={config.sheetmusic} onSelect={setSong} subRoute={subRoute} onSubRoute={onSubRoute} />;
  if (loading) return <SkeletonStage />;
  if (error) return <PianoEmpty message={error} actionLabel="Choose another song" onAction={() => setSong(null)} />;
  if (!chart) return <SkeletonStage />;
  return (
    <HeroGame
      song={song}
      chart={chart}
      gameConfig={gameConfig}
      onChooseSong={() => setSong(null)}
      onNoteOn={onNoteOn}
      onNoteOff={onNoteOff}
    />
  );
}

export default PianoHeroGame;
