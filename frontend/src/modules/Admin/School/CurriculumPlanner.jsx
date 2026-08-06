/**
 * CurriculumPlanner — what a learner is expected to work through.
 *
 * Assignments are PLANNER INPUT and nothing else (spec §7.2: "planning writes
 * planner config, never the published catalog"). The only write this screen can
 * make is `PUT /lifecycle/assignments/:learnerId`, which lands in
 * `apps/school/assignments/{learnerId}.yml`. There is no code path from here to
 * a unit, a document or a bank — a parent can reassign all day without any risk
 * of editing curriculum.
 *
 * ORDER IS PRIORITY. There is no `priority` field in the assignment record —
 * `planner.mjs` derives the agenda's order from required-before-elective, then
 * course sequence, then THE ORDER THE PARENT WROTE THE ENTRIES. So the arrows
 * here are the priority control, and the number beside each row is what that
 * position means. Inventing a `priority` key would have been silently dropped by
 * the store, so this screen edits the thing that is actually read.
 *
 * BACKEND GAP: no HTTP route serves the lifecycle curriculum catalog, so there
 * is no list of assignable units to pick from. Entries are typed by id, with
 * suggestions drawn from ids already assigned somewhere in the household. Until
 * a catalog endpoint exists this screen cannot offer a browse-and-tick picker.
 *
 * @module Admin/School/CurriculumPlanner
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon, Alert, Autocomplete, Badge, Button, Card, Code, Group, Loader,
  Select, Stack, Switch, Text, Title, Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import getLogger from '../../../lib/logging/Logger.js';
import { schoolAdminApi } from './schoolAdminApi.js';
import { useRoster } from './useRoster.js';
import { useGrader } from './useGrader.js';
import GraderBar from './GraderBar.jsx';
import './SchoolAdmin.scss';

/**
 * The store accepts a bare string or `{courseId|unitId, elective}`. Normalise
 * both to one editable shape; `toStored` puts it back in the explicit form so an
 * elective flag always survives a round trip.
 */
function toEntries(list, key) {
  return (Array.isArray(list) ? list : [])
    .map((entry) => {
      if (typeof entry === 'string' && entry.trim()) return { id: entry.trim(), elective: false };
      if (entry && typeof entry === 'object' && typeof entry[key] === 'string' && entry[key].trim()) {
        return { id: entry[key].trim(), elective: entry.elective === true };
      }
      return null;
    })
    .filter(Boolean);
}

const toStored = (entries, key) => entries.map((e) => ({ [key]: e.id, elective: e.elective === true }));

const move = (list, from, to) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/** One assignable list (courses or units) with its priority controls. */
function EntryList({
  title, entries, suggestions, editable, keyName, onChange, adding, setAdding,
}) {
  const add = () => {
    const id = (adding || '').trim();
    if (!id || entries.some((e) => e.id === id)) return;
    onChange([...entries, { id, elective: false }]);
    setAdding('');
  };

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" align="center" mb="xs">
        <Title order={5}>{title}</Title>
        <Badge variant="light" color="gray">{entries.length}</Badge>
      </Group>

      {entries.length === 0 && (
        <Text size="sm" c="dimmed" mb="xs">
          Nothing assigned. {editable ? 'Add one below.' : ''}
        </Text>
      )}

      <Stack gap={6}>
        {entries.map((entry, index) => (
          <Group key={entry.id} gap="xs" wrap="nowrap" data-testid={`entry-${keyName}`}>
            <Tooltip label="Priority — the agenda offers required work in this order" withArrow>
              <Badge variant="outline" color="gray" w={34}>{index + 1}</Badge>
            </Tooltip>
            <Code className="school-admin__entry-id">{entry.id}</Code>
            <Switch
              size="xs"
              label="Elective"
              checked={entry.elective}
              disabled={!editable}
              onChange={(event) => onChange(entries.map((e, i) => (
                i === index ? { ...e, elective: event.currentTarget.checked } : e
              )))}
            />
            <ActionIcon
              variant="subtle" size="sm" aria-label={`Move ${entry.id} up`}
              disabled={!editable || index === 0}
              onClick={() => onChange(move(entries, index, index - 1))}
            >
              <IconArrowUp size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle" size="sm" aria-label={`Move ${entry.id} down`}
              disabled={!editable || index === entries.length - 1}
              onClick={() => onChange(move(entries, index, index + 1))}
            >
              <IconArrowDown size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle" size="sm" color="red" aria-label={`Remove ${entry.id}`}
              disabled={!editable}
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
      </Stack>

      {editable && (
        <Group gap="xs" mt="sm" align="flex-end">
          <Autocomplete
            label={`Add ${keyName === 'courseId' ? 'a course' : 'a unit'} by id`}
            placeholder={keyName === 'courseId' ? 'math-fractions' : 'math-fractions.03'}
            data={suggestions}
            value={adding}
            onChange={setAdding}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            w={280}
          />
          <Button size="sm" leftSection={<IconPlus size={16} />} onClick={add} disabled={!adding.trim()}>
            Add
          </Button>
        </Group>
      )}
    </Card>
  );
}

export default function CurriculumPlanner() {
  const logger = useMemo(() => getLogger().child({ component: 'school-planner' }), []);

  const { roster, error: rosterError } = useRoster();
  const [teachersRead, setTeachersRead] = useState(null);
  useEffect(() => {
    let alive = true;
    schoolAdminApi.teachers()
      .then((t) => { if (alive) setTeachersRead(t); })
      .catch(() => { if (alive) setTeachersRead({ configured: false, teachers: [] }); });
    return () => { alive = false; };
  }, []);
  const { adults, graderId, grader, canSignOff, setGraderId } = useGrader(roster, teachersRead);
  const [pin, setPin] = useState('');

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [learnerId, setLearnerId] = useState(null);

  const [courses, setCourses] = useState([]);
  const [units, setUnits] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [addingCourse, setAddingCourse] = useState('');
  const [addingUnit, setAddingUnit] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(null);

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await schoolAdminApi.assignments();
      const list = Array.isArray(data?.assignments) ? data.assignments : [];
      setRecords(list);
      setLoadError(null);
      logger.debug('assignments-loaded', { learners: list.length });
      return list;
    } catch (err) {
      setRecords([]);
      setLoadError(err.message);
      logger.error('assignments-failed', { error: err.message, status: err.status });
      return [];
    } finally {
      setLoading(false);
    }
  }, [logger]);

  useEffect(() => {
    logger.info('mounted', {});
    loadAssignments();
    return () => logger.info('unmounted', {});
  }, [logger, loadAssignments]);

  // Default learner: the first non-adult on the roster, else the first record.
  useEffect(() => {
    if (learnerId) return;
    const year = new Date().getFullYear();
    const child = roster.find((u) => !u.birthyear || year - u.birthyear < 18);
    const fallback = child?.id ?? roster[0]?.id ?? records[0]?.learnerId ?? null;
    if (fallback) setLearnerId(fallback);
  }, [roster, records, learnerId]);

  // Load the chosen learner's record into the editor. A learner with no record
  // is not an error — it is an empty plan waiting to be written.
  useEffect(() => {
    if (!learnerId) return;
    const record = records.find((r) => r.learnerId === learnerId) ?? null;
    setCourses(toEntries(record?.courses, 'courseId'));
    setUnits(toEntries(record?.units, 'unitId'));
    setDirty(false);
    setSaveError(null);
    setSaved(null);
    setAddingCourse('');
    setAddingUnit('');
  }, [learnerId, records]);

  const suggestions = useMemo(() => {
    const courseIds = new Set();
    const unitIds = new Set();
    records.forEach((r) => {
      toEntries(r.courses, 'courseId').forEach((e) => courseIds.add(e.id));
      toEntries(r.units, 'unitId').forEach((e) => unitIds.add(e.id));
    });
    return { courses: [...courseIds].sort(), units: [...unitIds].sort() };
  }, [records]);

  const editCourses = useCallback((next) => { setCourses(next); setDirty(true); setSaved(null); }, []);
  const editUnits = useCallback((next) => { setUnits(next); setDirty(true); setSaved(null); }, []);

  const save = useCallback(async () => {
    if (!learnerId) return;
    if (!grader) {
      setSaveError('Only a grown-up may change what a child is assigned. Choose your profile above.');
      logger.warn('save-refused-not-adult', { learnerId, graderId });
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    // `assignedBy` is the server's business, not this screen's courtesy: the
    // planning write is refused unless it names a grown-up on the roster.
    const body = {
      courses: toStored(courses, 'courseId'),
      units: toStored(units, 'unitId'),
      assignedBy: grader.id,
      pin: pin || null,
    };
    logger.info('assignment-save-dispatch', {
      learnerId, by: grader.id, courses: body.courses.length, units: body.units.length,
    });
    try {
      await schoolAdminApi.putAssignment(learnerId, body);
      logger.info('assignment-save-ok', { learnerId, by: grader.id });
      setDirty(false);
      setSaved(`Saved by ${grader.name}.`);
      await loadAssignments();
    } catch (err) {
      setSaveError(`Nothing was saved (${err.message}). The plan on screen is not what the console will use.`);
      logger.error('assignment-save-failed', { learnerId, error: err.message, status: err.status });
    } finally {
      setSaving(false);
    }
  }, [learnerId, grader, graderId, courses, units, logger, loadAssignments]);

  const learnerOptions = useMemo(() => {
    const ids = new Set(roster.map((u) => u.id));
    // A learner with an assignment but no roster profile still has to be
    // reachable, or their plan becomes uneditable.
    const orphans = records.map((r) => r.learnerId).filter((id) => !ids.has(id));
    return [
      ...roster.map((u) => ({ value: u.id, label: u.name })),
      ...orphans.map((id) => ({ value: id, label: `${id} (not on the roster)` })),
    ];
  }, [roster, records]);

  return (
    <Stack gap="md" p="md" className="school-admin">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Stack gap={2}>
          <Title order={3}>What each learner is working through</Title>
          <Text size="sm" c="dimmed">
            This writes the plan only. The published curriculum — units, sheets and answer
            keys — is never touched from here.
          </Text>
        </Stack>
        <Button variant="subtle" size="xs" onClick={loadAssignments}>Refresh</Button>
      </Group>

      <GraderBar
        adults={adults}
        graderId={graderId}
        grader={grader}
        onChange={setGraderId}
        action="change a plan"
        label="Signed in as"
        teachersConfigured={teachersRead ? teachersRead.configured : null}
        pin={pin}
        onPinChange={setPin}
      />

      {rosterError && <Alert color="red" title="Could not load the household roster">{rosterError}</Alert>}
      {loadError && <Alert color="red" title="Could not load the assignments">{loadError}</Alert>}

      {loading ? <Loader /> : (
        <>
          <Select
            label="Learner"
            placeholder="Choose a learner"
            data={learnerOptions}
            value={learnerId}
            onChange={setLearnerId}
            allowDeselect={false}
            w={280}
          />

          {!canSignOff && (
            <Alert color="yellow" title="Read-only">
              A plan can only be changed by a grown-up. Choose an adult profile above to edit.
            </Alert>
          )}

          <EntryList
            title="Courses"
            entries={courses}
            suggestions={suggestions.courses}
            editable={canSignOff}
            keyName="courseId"
            onChange={editCourses}
            adding={addingCourse}
            setAdding={setAddingCourse}
          />

          <EntryList
            title="Single units"
            entries={units}
            suggestions={suggestions.units}
            editable={canSignOff}
            keyName="unitId"
            onChange={editUnits}
            adding={addingUnit}
            setAdding={setAddingUnit}
          />

          <Text size="xs" c="dimmed">
            The numbers are priority: the agenda offers required work in this order, and holds
            electives back until the required work is done.
          </Text>

          {saveError && <Alert color="red" title="The plan did not save">{saveError}</Alert>}
          {saved && !dirty && <Text size="sm" c="green">{saved}</Text>}

          <Group>
            <Button onClick={save} loading={saving} disabled={!canSignOff || !dirty || !learnerId}>
              Save plan
            </Button>
            {dirty && <Text size="sm" c="orange">Unsaved changes.</Text>}
          </Group>
        </>
      )}
    </Stack>
  );
}
