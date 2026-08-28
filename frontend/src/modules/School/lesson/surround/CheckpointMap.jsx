// frontend/src/modules/School/lesson/surround/CheckpointMap.jsx
//
// THE STOP MAP. One node per authored checkpoint along the lesson's own
// timeline, so nothing stops without warning: cleared ones carry a ✓, the next
// one is lit and pulses while the gate says it is approaching, the ones after
// it are locked. A hairline cursor says where the child is between them.
//
// IT IS A SCHOOL MODULE, REGISTERED INTO SURROUND (see
// `registerLessonSurround.js`). It lives here rather than in
// `modules/Surround/modules/` because the surround framework gains nothing
// structural from media lessons — it is the same one-way boundary the screen
// widgets keep, and the registry is deliberately a separate instance so a
// school module name can never shadow a concert-hall one.
//
// WHAT IT IS NOT
// --------------
// Not the gate. `useCheckpointGate` decides what stops the video; this draws
// what that hook already decided. In particular `approaching` — a strictly
// PRE-FIRE window, true only while the checkpoint is ahead and within ~5s — is
// READ, never recomputed. Recomputing it here would give the child a second
// opinion about whether the video is about to stop, and the two would disagree
// at exactly the boundary the warning exists for.
//
// THE ONE RULE (SurroundHost's header) BINDS HERE
// -----------------------------------------------
// The surround can never be the reason something will not play. So every path
// that is not "a usable list, drawn without throwing" renders NOTHING — no
// element, no empty box, no error text on a television in front of a child —
// and says which path it took in the log store. See `mapModel`'s `state`.
//
// WHY A MAP OF NOTHING IS NOT AN ERROR MESSAGE
// --------------------------------------------
// `useCheckpointGate` treats an unusable list as "no gate", so in both the
// empty case and the failed-to-load case the video will not stop. The child's
// screen is therefore identical, and correctly so: there is no warning to give,
// and a child can do nothing with "the checkpoint list failed to arrive". The
// difference is entirely an ADULT's, so it is drawn in the log store instead —
// `debug` for an ungated lesson (normal), `warn` for a list that arrived
// broken or never arrived at all (someone should look). The hard guarantee is
// untouched either way: the backend refuses `media_completed` while checkpoints
// are outstanding, so a client that lost its list cannot claim the credit.
//
// Module contract: { position, duration, playing, seeking, data, region, logger }.

/* eslint-disable react-refresh/only-export-components --
   The PURE decision lives beside the component it describes: `WorkPlacard`
   exports `plateText`, `SegmentMap` exports its splitters, and a reader looking
   for what this module decides looks in this file. The cost is fast-refresh
   granularity in dev, which the surround modules have already all accepted. */

import React, { useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  lessonSurroundLogger, lessonOf, clearedSetOf, checkpointIdOf, checkpointAtOf,
} from './lessonSurroundKit.js';
import './CheckpointMap.scss';

const clamp01 = (n) => (n < 0 ? 0 : (n > 1 ? 1 : n));

/** Trim a fraction to what a stylesheet can use, without a float tail. */
const frac = (n) => String(Math.round(clamp01(n) * 1e4) / 1e4);

/**
 * WHAT THE MAP IS, as a pure function. Exported because this is the part worth
 * asserting on its own — which node is next, which are done, and whether there
 * is a map at all. The component around it is wiring and one log line.
 *
 * @param {object} [input]
 * @param {Array} [input.checkpoints] the authored list.
 * @param {Set<string>|string[]} [input.clearedIds] what this learner has cleared.
 * @param {number} [input.position] playhead seconds.
 * @param {number} [input.duration] the lesson's length in seconds.
 * @param {boolean} [input.approaching] the GATE's pre-fire window. Read, never derived.
 * @returns {{state: 'ready'|'no-list'|'ungated'|'unplaceable', nodes: Array,
 *            progress: number|null, scaled: boolean, authored: number}}
 */
export function mapModel({ checkpoints, clearedIds, position, duration, approaching } = {}) {
  const none = (state, authored = 0) => ({
    state, nodes: [], progress: null, scaled: false, authored,
  });
  if (!Array.isArray(checkpoints)) return none('no-list');
  if (checkpoints.length === 0) return none('ungated');

  const cleared = clearedSetOf(clearedIds);
  // A checkpoint with no usable `at` is SKIPPED, the same way the gate skips it:
  // it cannot be positioned, so it can never fire and there is nowhere on the
  // rail to draw it. Its neighbours are unaffected.
  const placed = [];
  for (const raw of checkpoints) {
    const at = checkpointAtOf(raw);
    if (at === null) continue;
    placed.push({ at, id: checkpointIdOf(raw, at) });
  }
  if (placed.length === 0) return none('unplaceable', checkpoints.length);

  // FIRST UNCLEARED, not nearest. The same rule the gate uses, and the reason a
  // rewound-past checkpoint is never lit: it is CLEARED, and a node cannot be
  // both ✓ and the stop that is coming.
  const currentIndex = placed.findIndex((cp) => !cleared.has(cp.id));

  // THE CLOCK MAY NOT HAVE REPORTED A LENGTH YET. Without one there is no axis:
  // every node would pin to zero and the map would read as one mark rather than
  // four stops. Even spacing keeps the COUNT and the ORDER — which is most of
  // what the map is for — and the cursor is withheld rather than parked at the
  // left edge, because a cursor that is not on the clock is a lie about where
  // the child is.
  const scaled = Number.isFinite(duration) && duration > 0;
  const nodes = placed.map((cp, i) => ({
    id: cp.id,
    at: cp.at,
    ordinal: i + 1,
    fraction: scaled ? clamp01(cp.at / duration) : (i + 1) / (placed.length + 1),
    state: i === currentIndex ? 'current' : (cleared.has(cp.id) ? 'cleared' : 'locked'),
    pulse: i === currentIndex && approaching === true,
  }));

  const progress = scaled && Number.isFinite(position) ? clamp01(position / duration) : null;
  return { state: 'ready', nodes, progress, scaled, authored: checkpoints.length };
}

export default function CheckpointMap({
  position = 0,
  duration = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  playing = false,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  seeking = false,
  data = null,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  region = null,
  logger = null,
}) {
  const log = useMemo(() => lessonSurroundLogger(logger, 'checkpoint-map'), [logger]);
  const lesson = lessonOf(data);
  const contentId = data?.contentId ?? null;

  const model = mapModel({
    checkpoints: lesson?.checkpoints,
    clearedIds: lesson?.cleared ?? lesson?.clearedIds,
    position,
    duration,
    approaching: lesson?.approaching,
  });

  const { state, authored } = model;
  const drawn = model.nodes.length;
  const cleared = model.nodes.filter((n) => n.state === 'cleared').length;

  // ONE EVENT PER MAP, on the edge — not per 10 Hz tick. `state` and the counts
  // are the whole answer to "what did the chrome draw, and why not more".
  useEffect(() => {
    if (state === 'ready') {
      log.info('school.surround.map.drawn', { contentId, authored, drawn, cleared });
      return;
    }
    if (state === 'ungated') {
      log.debug('school.surround.map.ungated', { contentId });
      return;
    }
    log.warn('school.surround.map.unusable', {
      contentId, reason: state, authored, placeable: drawn,
    });
    // The counts change with the lesson, not with the playhead; `cleared` moves
    // once per checkpoint and re-announcing the map then is the point.
  }, [state, authored, drawn, cleared, contentId, log]);

  if (state !== 'ready') return null;

  const { nodes, progress, scaled } = model;
  const cursor = progress === null ? null : frac(progress);

  return (
    <div
      className="lesson-checkpoint-map"
      data-testid="lesson-checkpoint-map"
      data-scaled={String(scaled)}
      data-count={String(nodes.length)}
      data-cleared={String(cleared)}
    >
      <div className="lesson-checkpoint-map__rail">
        {cursor !== null && (
          <div
            className="lesson-checkpoint-map__fill"
            style={{ '--lesson-map-position': cursor }}
            aria-hidden="true"
          />
        )}
        <ol className="lesson-checkpoint-map__nodes">
          {nodes.map((node) => (
            <li
              key={node.id}
              className={`lesson-checkpoint-map__node lesson-checkpoint-map__node--${node.state}`}
              data-testid="lesson-checkpoint-node"
              data-state={node.state}
              data-at={String(node.at)}
              data-approaching={String(node.pulse)}
              style={{ '--lesson-node-at': frac(node.fraction) }}
            >
              <span className="lesson-checkpoint-map__mark" aria-hidden="true">
                {node.state === 'cleared' ? '✓' : node.ordinal}
              </span>
              <span className="lesson-checkpoint-map__sr">
                {node.state === 'cleared'
                  ? `Question ${node.ordinal}, done`
                  : `Question ${node.ordinal} of ${nodes.length}`}
              </span>
            </li>
          ))}
        </ol>
        {cursor !== null && (
          <div
            className="lesson-checkpoint-map__cursor"
            data-testid="lesson-checkpoint-cursor"
            style={{ '--lesson-map-position': cursor }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

CheckpointMap.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
