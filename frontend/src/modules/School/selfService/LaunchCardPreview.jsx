/**
 * LaunchCardPreview — a grown-up opening a launch card from a link.
 *
 * A launch card used to be reachable only by minting a real panel code: print
 * an agenda, read six digits off it, type them before they expired. That is a
 * lot of ceremony to answer "does this course's poster resolve yet?".
 *
 * IT RENDERS THE PANEL'S CARD, NOT A DRAWING OF ONE. The opaque preview link
 * goes to `/self-service/preview`, which verifies or decodes it and resolves
 * the card through the SAME read-only resolver and the SAME builder a typed code goes through. If
 * this component showed a card assembled any other way it would answer
 * questions about a surface the house does not run, which is worse than no
 * preview at all.
 *
 * NOTHING HERE IS LIVE. The backend marks every action inert and `LaunchCard`
 * draws them disabled under a band that says so; there is no `onAction` wired
 * at all, and `/act` — the only route that opens work — takes a six-digit code
 * this surface does not have.
 *
 * NEVER A BLANK SCREEN. A link that will not decode, a backend that will not
 * answer, a fetch that never lands: all three end in a sentence and a way home.
 */
import { useEffect, useState } from 'react';
import LaunchCard from './LaunchCard.jsx';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

const UNREACHABLE = 'The school computer is not answering the preview. Try again in a minute.';

export default function LaunchCardPreview({ link, onExit }) {
  const [state, setState] = useState({ status: 'loading', card: null, sentence: null });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading', card: null, sentence: null });
    (async () => {
      const { ok, status, data } = await schoolApi.selfServicePreview(link);
      if (!live) return;
      // A non-2xx here is the BACKEND being unwell — an unreadable payload is a
      // 200 carrying its own sentence, exactly as a bad panel code is. The two
      // must not be shown with the same words.
      if (!ok || !data) {
        schoolLog.selfService('preview.unreachable', { httpStatus: status });
        setState({ status: 'error', card: null, sentence: UNREACHABLE });
        return;
      }
      schoolLog.selfService('preview.resolved', {
        ok: data.ok === true,
        reason: data.reason ?? null,
        actions: Array.isArray(data.actions) ? data.actions.map((a) => a.kind) : [],
      });
      setState({
        status: data.ok === true ? 'ready' : 'refused',
        card: data,
        sentence: data.sentence ?? null,
      });
    })();
    return () => { live = false; };
  }, [link]);

  if (state.status === 'loading') {
    return (
      <section className="school-selfservice-card is-loading" data-testid="selfservice-preview-loading">
        <p role="status">Loading the preview…</p>
      </section>
    );
  }

  // `view="sentence"` is the card's own never-dead-end shape: the message plus
  // a single Done. Reused rather than reinvented so a refused preview reads the
  // way a refused code reads.
  return (
    <LaunchCard
      card={state.card ?? { ok: false, preview: true, actions: [] }}
      preview
      view={state.status === 'ready' ? 'card' : 'sentence'}
      sentence={state.sentence}
      onAction={() => {}}
      onConfirm={() => {}}
      onExit={onExit}
    />
  );
}
