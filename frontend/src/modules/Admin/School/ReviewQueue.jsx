/**
 * ReviewQueue — the screen the whole paper loop was waiting for.
 *
 * The console grades through a PERSON on purpose. A smudged bubble row, an empty
 * one, a written sentence with no answer key behind it — none of those get a
 * machine verdict. They land in `apps/school/review/{sessionId}.yml` and the
 * session stops until a grown-up says correct or incorrect. Until this page
 * existed, that queue had no door.
 *
 * Design rules this page is holding up:
 *
 *  - **Adult-only sign-off.** The verdict is attributed to a real roster id, and
 *    only an adult's (`useGrader`). A child cannot mark their own sheet here.
 *  - **Nothing fails quietly.** A queue that will not load, and a sign-off that
 *    did not land, each paint at the moment it happens — the second one against
 *    the item it belongs to, so the parent knows exactly which mark is missing.
 *  - **Optimism is banned.** An item leaves the list when the SERVER says it is
 *    resolved, never when the button is clicked.
 *
 * TWO DIFFERENT THINGS, SHOWN AS TWO DIFFERENT THINGS. `prompt` is what the
 * question ASKED — the bank item's own wording, or the sheet's — and it differs
 * on every row. `rubric` is how the unit says to mark the sheet, and it is the
 * same sentence on every row. They used to be one field holding the rubric, so a
 * parent marking six questions read the same line six times.
 *
 * The unit is NAMED rather than numbered: `GET /lifecycle/curriculum/units`
 * gives the title and objectives behind `math-fractions.03`. A catalog that
 * will not load costs the parent a title, never a sign-off — the id is the
 * fallback and the grading controls do not depend on it.
 *
 * @module Admin/School/ReviewQueue
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Card, Code, Divider, Group, Loader, SegmentedControl,
  Stack, Text, Textarea, Title, Tooltip,
} from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { schoolAdminApi } from './schoolAdminApi.js';
import { useRoster } from './useRoster.js';
import { useGrader } from './useGrader.js';
import GraderBar from './GraderBar.jsx';
import './SchoolAdmin.scss';

const POLL_MS = 20000;

/** Why the machine refused to score it — in words a person uses. */
const REASONS = {
  ambiguous: { color: 'orange', label: 'Unreadable marks', help: 'The reader saw more than one mark, or a smudge it would not guess at.' },
  blank: { color: 'gray', label: 'Left blank', help: 'Nothing was filled in for this question.' },
  free_response: { color: 'blue', label: 'Written answer', help: 'There is no answer key for this one — it was written, so it needs reading.' },
  unscorable: { color: 'red', label: 'Could not be scored', help: 'The console could not score this question.' },
  machine: { color: 'teal', label: 'Machine-marked', help: 'Scored by the engine; shown here for the record.' },
};

const reasonOf = (reason) => REASONS[reason] ?? { color: 'gray', label: reason || 'Unknown', help: '' };

/** Newest first. Items with no timestamp sort last rather than jumping the queue. */
function newestFirst(items) {
  return [...items].sort((a, b) => {
    const at = Date.parse(a?.enqueuedAt ?? '') || 0;
    const bt = Date.parse(b?.enqueuedAt ?? '') || 0;
    return bt - at;
  });
}

const keyOf = (item) => `${item.sessionId}::${item.itemId}`;

/** Render whatever the child actually put down, whatever shape it arrived in. */
function SubmittedAnswer({ given }) {
  if (given === null || given === undefined || given === '') {
    return <Text size="sm" c="dimmed" fs="italic">Nothing was written — the question came back empty.</Text>;
  }
  if (typeof given === 'string' || typeof given === 'number' || typeof given === 'boolean') {
    return <Text size="sm" className="school-admin__answer">{String(given)}</Text>;
  }
  // OMR marks and anything else structured: show it rather than hide it.
  return <Code block className="school-admin__answer">{JSON.stringify(given, null, 2)}</Code>;
}

export default function ReviewQueue() {
  const logger = useMemo(() => getLogger().child({ component: 'school-review' }), []);

  const { roster, error: rosterError, nameFor } = useRoster();
  const [teachersRead, setTeachersRead] = useState(null);
  useEffect(() => {
    let alive = true;
    schoolAdminApi.teachers()
      .then((t) => { if (alive) setTeachersRead(t); })
      .catch(() => { if (alive) setTeachersRead({ configured: false, teachers: [] }); });
    return () => { alive = false; };
  }, []);
  const { adults, graderId, grader, canSignOff, setGraderId } = useGrader(roster, teachersRead);
  // The console PIN (teacher-console spec §1): sent with every sign-off; the
  // server only enforces it when one is configured. In-memory only.
  const [pin, setPin] = useState('');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [verdicts, setVerdicts] = useState({});   // key -> 'correct' | 'incorrect'
  const [busyKey, setBusyKey] = useState(null);
  const [itemErrors, setItemErrors] = useState({}); // key -> message
  const [notes, setNotes] = useState({});           // key -> what the parent typed
  const [units, setUnits] = useState({});           // unitId -> { title, objectives }
  const [signedOff, setSignedOff] = useState({});   // key -> confirmation line

  // Race guard (the house pattern): a slow poll must never overwrite a newer
  // reply, and must never resurrect an item a parent just marked.
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const data = await schoolAdminApi.pendingReview();
      if (seq !== seqRef.current) {
        logger.debug('refresh-superseded', { seq, latest: seqRef.current });
        return;
      }
      const list = Array.isArray(data?.items) ? data.items : [];
      setItems(list);
      setLoadError(null);
      logger.debug('queue-loaded', { pending: list.length });
    } catch (err) {
      if (seq !== seqRef.current) return;
      setLoadError(err.message);
      logger.error('queue-failed', { error: err.message, status: err.status });
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [logger]);

  // The catalog changes on the timescale of a parent editing YAML, so it is
  // read ONCE per mount rather than on every poll.
  useEffect(() => {
    let live = true;
    schoolAdminApi.curriculumUnits()
      .then((data) => {
        if (!live) return;
        const list = Array.isArray(data?.units) ? data.units : [];
        setUnits(Object.fromEntries(list.map((u) => [u.unitId, u])));
        logger.debug('curriculum-loaded', { units: list.length });
      })
      .catch((err) => {
        // A missing title is a cosmetic loss; the queue still grades.
        if (live) logger.warn('curriculum-failed', { error: err.message, status: err.status });
      });
    return () => { live = false; };
  }, [logger]);

  useEffect(() => {
    logger.info('mounted', {});
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(timer);
      logger.info('unmounted', {});
    };
  }, [logger, refresh]);

  const editNote = useCallback((key, text) => {
    setNotes((prev) => ({ ...prev, [key]: text }));
  }, []);

  const chooseVerdict = useCallback((key, verdict) => {
    setVerdicts((prev) => ({ ...prev, [key]: verdict }));
    setItemErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    logger.debug('verdict-chosen', { key, verdict });
  }, [logger]);

  const signOff = useCallback(async (item) => {
    const key = keyOf(item);
    const verdict = verdicts[key];
    const typed = (notes[key] ?? item.note ?? '').trim();
    const note = typed || null;

    // Both guards are real refusals, not disabled-button theatre: this function
    // is the last thing between a click and a permanent mark on a child's work.
    if (!verdict) {
      setItemErrors((prev) => ({ ...prev, [key]: 'Choose correct or incorrect first.' }));
      return;
    }
    if (!grader) {
      setItemErrors((prev) => ({ ...prev, [key]: 'Only a grown-up may sign off. Choose your profile above.' }));
      logger.warn('signoff-refused-not-adult', { key, graderId });
      return;
    }

    setBusyKey(key);
    setItemErrors((prev) => ({ ...prev, [key]: undefined }));
    logger.info('signoff-dispatch', {
      sessionId: item.sessionId, itemId: item.itemId, learnerId: item.learnerId,
      unitId: item.unitId, verdict, gradedBy: grader.id, note: Boolean(note),
    });
    try {
      const resolved = await schoolAdminApi.resolveReview(item.sessionId, item.itemId, {
        verdict, gradedBy: grader.id, note, pin: pin || null,
      });
      logger.info('signoff-ok', {
        sessionId: item.sessionId, itemId: item.itemId,
        verdict: resolved?.verdict ?? verdict, gradedBy: resolved?.gradedBy ?? grader.id,
      });
      setSignedOff((prev) => ({
        ...prev,
        [key]: `Marked ${resolved?.verdict ?? verdict} by ${grader.name}.`,
      }));
      // The server is the authority on what is still pending.
      await refresh();
    } catch (err) {
      setItemErrors((prev) => ({
        ...prev,
        [key]: `That mark did not save (${err.message}). It is still waiting — try again.`,
      }));
      logger.error('signoff-failed', {
        sessionId: item.sessionId, itemId: item.itemId, verdict,
        error: err.message, status: err.status,
      });
    } finally {
      setBusyKey(null);
    }
  }, [verdicts, notes, grader, graderId, logger, refresh]);

  const ordered = useMemo(() => newestFirst(items), [items]);

  return (
    <Stack gap="md" p="md" className="school-admin">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Stack gap={2}>
          <Title order={3}>Work waiting for a grown-up</Title>
          <Text size="sm" c="dimmed">
            Anything the console would not score itself. A child&apos;s session stays open until
            these are marked.
          </Text>
        </Stack>
        <Button variant="subtle" size="xs" onClick={refresh}>Refresh</Button>
      </Group>

      <GraderBar
        adults={adults}
        graderId={graderId}
        grader={grader}
        onChange={setGraderId}
        action="sign off"
        teachersConfigured={teachersRead ? teachersRead.configured : null}
        pin={pin}
        onPinChange={setPin}
      />

      {rosterError && (
        <Alert color="red" title="Could not load the household roster">
          {rosterError} — names show as ids and nobody can sign off until this loads.
        </Alert>
      )}

      {loadError && (
        <Alert color="red" title="Could not load the review queue">
          {loadError}
        </Alert>
      )}

      {loading && <Loader />}

      {!loading && !loadError && ordered.length === 0 && (
        <Card withBorder padding="lg" className="school-admin__empty">
          <Stack gap={4} align="center">
            <Text fw={600}>Nothing is waiting for you.</Text>
            <Text size="sm" c="dimmed" ta="center">
              Every handed-in sheet has been marked. When a child submits work the console
              cannot score — a written answer, a blank, or an unreadable bubble row — it will
              appear here.
            </Text>
          </Stack>
        </Card>
      )}

      <Stack gap="md">
        {ordered.map((item) => {
          const key = keyOf(item);
          const reason = reasonOf(item.reason);
          const chosen = verdicts[key] ?? null;
          const itemError = itemErrors[key];
          const busy = busyKey === key;

          return (
            <Card withBorder padding="md" key={key} data-testid="review-item" className="school-admin__item">
              <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
                <Group gap="xs" wrap="wrap">
                  <Text fw={600}>{nameFor(item.learnerId)}</Text>
                  <Tooltip label={reason.help} disabled={!reason.help} withArrow>
                    <Badge color={reason.color} variant="light">{reason.label}</Badge>
                  </Tooltip>
                </Group>
                <Text size="xs" c="dimmed">
                  Handed in {item.enqueuedAt ? new Date(item.enqueuedAt).toLocaleString() : 'at an unknown time'}
                </Text>
              </Group>

              <Group gap="xs" mt={6} wrap="wrap">
                <Text size="sm" c="dimmed">Unit</Text>
                {units[item.unitId]?.title
                  ? <Text size="sm" fw={600}>{units[item.unitId].title}</Text>
                  : <Code>{item.unitId || 'unknown'}</Code>}
                <Text size="sm" c="dimmed">Question</Text>
                <Code>{item.itemId}</Code>
                {Number.isFinite(item.questionNumber) && (
                  <Badge variant="outline" color="gray">Question {item.questionNumber}</Badge>
                )}
              </Group>

              {units[item.unitId]?.objectives?.length > 0 && (
                <Text size="xs" c="dimmed" mt={4}>
                  Teaching: {units[item.unitId].objectives.join('; ')}
                </Text>
              )}

              <Divider my="sm" />

              {/* WHAT WAS ASKED comes first: a parent cannot mark an answer
                  they cannot see the question for. It is the bank item's own
                  wording (or the sheet's), so it differs on every row — unlike
                  the rubric below, which is the same for the whole sheet. */}
              <Text size="sm" fw={600} mb={4}>What was asked</Text>
              {item.prompt ? (
                <Text size="sm" className="school-admin__prompt">{item.prompt}</Text>
              ) : (
                <Text size="sm" c="dimmed" fs="italic">
                  We do not have the wording of this question — it is
                  {' '}<Code>{item.itemId}</Code>{Number.isFinite(item.questionNumber) ? `, question ${item.questionNumber} on the sheet.` : ' on the sheet.'}
                </Text>
              )}

              <Text size="sm" fw={600} mt="sm" mb={4}>What they put down</Text>
              <SubmittedAnswer given={item.given} />

              {item.rubric && (
                <>
                  <Text size="sm" fw={600} mt="sm" mb={4}>How this unit says to mark it</Text>
                  <Text size="sm" c="dimmed" className="school-admin__rubric">{item.rubric}</Text>
                </>
              )}

              <Divider my="sm" />

              {/* The verdict control is ALWAYS live. Choosing correct or
                  incorrect writes nothing, and hiding it made the page look
                  like it had no grading on it at all until an adult was
                  picked. The gate belongs on the write, which is the button
                  below — it does not exist for anyone but an adult. */}
              {/* A parent explaining WHY is the most valuable thing on this
                  screen, and it used to have nowhere to go — the route read
                  only a verdict and an id, so a box here would have thrown
                  their words away. It is stored with the verdict now. */}
              <Textarea
                label={`Note for ${nameFor(item.learnerId)} (optional)`}
                description="Why it was marked this way. Kept with the verdict."
                placeholder="Right method — you forgot to simplify at the end."
                autosize
                minRows={2}
                mb="sm"
                value={notes[key] ?? item.note ?? ''}
                onChange={(event) => editNote(key, event.currentTarget.value)}
              />

              <Group gap="sm" wrap="wrap" align="center">
                <SegmentedControl
                  size="sm"
                  value={chosen ?? ''}
                  onChange={(value) => chooseVerdict(key, value)}
                  data={[
                    { label: 'Correct', value: 'correct' },
                    { label: 'Incorrect', value: 'incorrect' },
                  ]}
                />
                {canSignOff ? (
                  <Button
                    size="sm"
                    disabled={!chosen}
                    loading={busy}
                    onClick={() => signOff(item)}
                  >
                    Sign off as {grader.name}
                  </Button>
                ) : (
                  <Text size="sm" c="orange">
                    Choose a grown-up&apos;s profile at the top to sign this off.
                  </Text>
                )}
              </Group>

              {itemError && (
                <Alert color="red" mt="sm" title="That mark did not save" data-testid="review-item-error">
                  {itemError}
                </Alert>
              )}

              {signedOff[key] && !itemError && (
                <Text size="sm" c="green" mt="sm">{signedOff[key]}</Text>
              )}
            </Card>
          );
        })}
      </Stack>
    </Stack>
  );
}
