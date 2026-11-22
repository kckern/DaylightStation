import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react';
import { useRetryRegion } from '@/lib/ui';
import { useTriage } from "../../../hooks/useTriage.js";
import { LifeUserContext } from "../../../hooks/useLifeUser.js";
import { LoadingState } from "../../../components/index.js";
import LoginScreen from "../../../../../../../frontend/src/modules/Auth/LoginScreen.jsx";
import getLogger from "../../../../../../../frontend/src/lib/logging/Logger.js";
import { StepStrip } from "./StepStrip.jsx";
import { TriageCard, DRY_RUN_NOTE } from "./TriageCard.jsx";

const BUSY_LINE = 'Triage is updating — try again in a moment.';
const FAILED_REASONS = {
  mailbox_permission_missing: 'The mailbox needs reconnecting before this can be done.',
  mailbox_unavailable: "The mailbox isn't reachable right now.",
  task_destination_unavailable: "There's no single list to put the new todo in.",
};

/**
 * The guided triage session at /life/now/triage: one card at a time, a step strip and
 * progress bar, choices with the suggested one marked, a reply copilot, free text + voice,
 * the recap with its action log and undo, and the owner's resolve for in-doubt cards.
 */
export function TriageSessionView() {
  const logger = useMemo(() => getLogger().child({ component: 'triage-session' }), []);
  const t = useTriage({ withSession: true });
  const { session, summary, needsLogin, signInReason } = t;
  const selectedMember = useContext(LifeUserContext);
  const { regionProps, retry } = useRetryRegion(t.refetch, t.loading);

  const [cards, setCards] = useState([]);
  const [idx, setIdx] = useState(0);
  const [tally, setTally] = useState({ answered: 0, skipped: 0 });
  const [notice, setNotice] = useState(null); // { text, retry?, retryChoice?, tone? }
  const [text, setText] = useState('');
  const [pending, setPending] = useState(null); // a choice waiting for the owner's text (shrink)
  const [focusKey, setFocusKey] = useState(null);
  const [highlightSend, setHighlightSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    logger.info('triage.session.mounted');
    return () => { mounted.current = false; logger.debug('triage.session.unmounted'); };
  }, [logger]);

  useEffect(() => {
    if (needsLogin) logger.info('triage.login.required');
  }, [needsLogin, logger]);

  // A fresh session (first load, or after signing in) restarts the walk through its cards.
  useEffect(() => {
    if (!session) return;
    setCards(session.cards ?? []);
    setIdx(0);
    setTally({ answered: 0, skipped: 0 });
    logger.debug('triage.session.loaded', { cards: session.cards?.length ?? 0, total: session.total, done: session.done });
  }, [session, logger]);

  const card = cards[idx] ?? null;
  const resetAnswer = () => { setText(''); setPending(null); setFocusKey(null); setHighlightSend(false); };

  const advance = (counted) => {
    resetAnswer();
    setTally((s) => (counted ? { ...s, answered: s.answered + 1 } : { ...s, skipped: s.skipped + 1 }));
    setIdx((i) => i + 1);
  };
  const replaceCard = (next) => {
    if (!next) return;
    setCards((list) => list.map((c) => (c.cardId === next.cardId ? { ...c, ...next } : c)));
  };

  const handleError = (err, retry, current, choice) => {
    const code = err?.code ?? null;
    logger.warn('triage.card.error', { cardId: current?.cardId ?? null, code, status: err?.status ?? null });
    if (err?.signInReason) return; // the login screen takes the card's place
    if (code === 'pass_running' || code === 'busy') { setNotice({ text: BUSY_LINE, retry, retryChoice: choice }); return; }
    if (code === 'answer_in_doubt') { replaceCard({ ...current, status: 'applying', applying: true }); return; }
    if (code === 'card_not_open' || code === 'card_not_found') {
      advance(false);
      setNotice({ text: 'Already handled elsewhere — moved on.' });
      return;
    }
    setNotice({ text: "That didn't go through — the card is still here.", retry, retryChoice: choice, tone: 'error' });
  };

  const handleOutcome = (r, current, choice) => {
    const outcome = r?.outcome ?? 'failed';
    if (outcome === 'skipped_by_owner') {
      logger.info('triage.card.skipped', { kind: current.kind });
      advance(false);
      return;
    }
    logger.info('triage.card.answered', { kind: current.kind, choice: choice ?? null, outcome });
    if (outcome === 'applied') { advance(true); return; }
    if (outcome === 'conflict') { advance(true); setNotice({ text: 'This changed since — skipped' }); return; }
    if (outcome === 'draft_updated') {
      replaceCard(r.card);
      resetAnswer();
      setNotice({ text: 'Draft updated — check it, then Send.' });
      return;
    }
    if (outcome === 'reopened') { replaceCard({ ...(r.card ?? current), applying: false, status: 'open' }); return; }
    if (outcome === 'skipped') {
      if (r.interpreted === 'send') { setHighlightSend(true); return; }
      if (r.needsText) {
        setPending('shrink');
        setFocusKey(`${current.cardId}:${Date.now()}`);
        return;
      }
      setNotice({ text: "Didn't catch that — tap a choice or say it another way." });
      return;
    }
    if (r?.inDoubt) { replaceCard({ ...current, ...(r.card ?? {}), status: 'applying', applying: true }); return; }
    setNotice({ text: FAILED_REASONS[r?.reason] ?? "That didn't go through — the card is still here.", tone: 'error' });
  };

  const perform = useCallback(async (current, choice, fn) => {
    const attempt = async () => {
      setBusy(true);
      setNotice(null);
      try {
        const r = await fn();
        if (mounted.current) handleOutcome(r, current, choice);
      } catch (err) {
        if (mounted.current) handleError(err, attempt, current, choice);
      } finally {
        if (mounted.current) setBusy(false);
      }
    };
    return attempt();
  // handleOutcome/handleError only touch state setters and the logger
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logger]);

  if (needsLogin) {
    const ownerName = selectedMember?.displayName || selectedMember?.username;
    return (
      <SessionLayout regionProps={regionProps}>
        <Text size="sm" c="dimmed" ta="center" role="status">
          {signInReason === 'session_user_mismatch' && ownerName
            ? `Sign in as ${ownerName} to answer their triage cards.`
            : 'Sign in to answer triage cards.'}
        </Text>
        <div className="life-triage__login"><LoginScreen onLogin={() => t.refetch()} /></div>
      </SessionLayout>
    );
  }
  if (t.loading && !session) return <SessionLayout regionProps={regionProps}><LoadingState /></SessionLayout>;
  if (!session) {
    return (
      <SessionLayout regionProps={regionProps}>
        {summary && summary.enrolled !== true ? (
          <Text c="dimmed">Triage isn&apos;t set up for this person.</Text>
        ) : (
          <Group gap="xs" role="status">
            <IconAlertCircle size={16} color="var(--ds-text-mid)" />
            <Text size="sm" c="dimmed">Triage unavailable</Text>
            <Button variant="subtle" size="compact-sm" onClick={retry}>retry</Button>
          </Group>
        )}
      </SessionLayout>
    );
  }

  const steps = session.steps ?? [];
  const total = session.total ?? cards.length;
  const position = (session.done ?? 0) + idx + 1;
  // Urgent replies are their own step even though their card step is 'reply'.
  const hasUrgent = steps.some((s) => s.id === 'urgent');
  const stepOf = (c) => (c.kind === 'recap' ? 'recap' : (c.urgent && hasUrgent ? 'urgent' : c.step));
  const stepId = card ? stepOf(card) : null;
  const stepPos = card ? idx - cards.findIndex((c) => stepOf(c) === stepId) + 1 : 0;
  const hasRecap = cards.some((c) => c.kind === 'recap');

  const onChoice = (choice) => perform(card, choice, () => t.answer(card.cardId, { choice }));
  const onSend = (body) => perform(card, 'send', () => t.answer(card.cardId, body ? { choice: 'send', draft: { body } } : { choice: 'send' }));
  const onDraftChange = () => setNotice((current) => current?.retryChoice === 'send' ? null : current);
  const onSubmitText = (said) => {
    const body = pending ? { choice: pending, text: said } : { text: said };
    return perform(card, pending ?? null, () => t.answer(card.cardId, body));
  };
  const onSkip = () => perform(card, 'skip', async () => {
    await t.skip(card.cardId);
    return { outcome: 'skipped_by_owner' };
  });
  const onResolve = (happened) => perform(card, happened ? 'resolve_yes' : 'resolve_no', () => t.resolve(card.cardId, happened));

  return (
    <SessionLayout regionProps={regionProps}>
      {summary?.mode === 'dryRun' && !hasRecap && <Text size="xs" c="dimmed">{DRY_RUN_NOTE}</Text>}
      <StepStrip steps={steps} currentStep={card ? stepId : null} stepPos={stepPos} position={card ? position : total} total={total} />
      {notice && (
        <Group gap="xs" justify="space-between" wrap="nowrap" className={`life-triage__notice${notice.tone === 'error' ? ' life-triage__notice--error' : ''}`} role="status">
          <Text size="sm">{notice.text}</Text>
          {notice.retry && <Button size="compact-sm" variant="light" className="life-triage__retry" onClick={notice.retry} disabled={busy}>Try again</Button>}
        </Group>
      )}
      {card ? (
        <TriageCard
          key={card.cardId}
          card={card}
          mode={summary?.mode}
          busy={busy}
          text={text}
          onTextChange={setText}
          onSubmitText={onSubmitText}
          prompt={pending === 'shrink' ? "What's the smaller next step?" : null}
          focusKey={focusKey}
          highlightSend={highlightSend}
          onChoice={onChoice}
          onSend={onSend}
          onDraftChange={onDraftChange}
          onSkip={onSkip}
          onResolve={onResolve}
          onUndo={(entryId) => t.undo(entryId)}
          onLoadLog={(options) => t.log(7, options)}
          wouldHave={summary?.wouldHave ?? null}
        />
      ) : (
        <article className="life-triage__card life-triage__card--end">
          <Group gap="xs"><IconCircleCheck size={20} color="var(--ds-success)" /><Text fw={600}>All done for now.</Text></Group>
          <Text size="sm" c="dimmed">
            {tally.answered} answered{tally.skipped ? ` · ${tally.skipped} skipped for later` : ''}
          </Text>
          <Button component={Link} to="/life/now" size="sm"
            className="life-triage__end-action ds-touch-target">Back to Now</Button>
        </article>
      )}
    </SessionLayout>
  );
}

function SessionLayout({ regionProps, children }) {
  return (
    <section className="life-triage" aria-label="Triage session" {...regionProps}>
      <SessionHeader />
      {children}
    </section>
  );
}

function SessionHeader() {
  const day = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <Group justify="space-between" align="center" wrap="nowrap">
      <div>
        <Title order={3}>Triage</Title>
        <Text size="xs" c="dimmed">{day}</Text>
      </div>
      <Button component={Link} to="/life/now" variant="subtle" size="compact-sm" color="gray"
        className="ds-touch-target">Stop for now</Button>
    </Group>
  );
}

export default TriageSessionView;
