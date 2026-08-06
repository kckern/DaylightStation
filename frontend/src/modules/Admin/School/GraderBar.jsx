/**
 * "Who is marking?" — the one place a grown-up claims the actions on these
 * screens. Rendered by every School parent surface so the answer is visible at
 * the moment it matters rather than assumed.
 *
 * Only adults are listed (see `useGrader`). When nobody is chosen — or the
 * remembered choice no longer resolves to an adult — this says so plainly and
 * the surrounding screen keeps its write controls shut.
 *
 * @module Admin/School/GraderBar
 */
import { Alert, Group, PasswordInput, Select, Text } from '@mantine/core';

/**
 * @param {object} props
 * @param {object[]} props.adults
 * @param {string|null} props.graderId
 * @param {object|null} props.grader
 * @param {(id: string|null) => void} props.onChange
 * @param {string} props.action - what the sign-in unlocks, for the empty-state copy
 * @param {string} props.label - the picker's label; it must name what this
 *   screen actually does, or a planning page reads "Marking as"
 */
export default function GraderBar({
  adults, graderId, grader, onChange, action = 'sign off', label = 'Marking as',
  teachersConfigured = null, pin = undefined, onPinChange = null,
}) {
  if (!adults.length) {
    // Distinguish the two empties (teacher-console spec §4.7.1): no
    // `teachers:` key configured at all vs a configured list none of whose
    // entries resolve to a grown-up on the roster.
    if (teachersConfigured === false) {
      return (
        <Alert color="yellow" title="No teachers configured">
          Add a <strong>teachers:</strong> list (roster ids) to{' '}
          <strong>school.yml</strong> — sign-off authority comes from it.
        </Alert>
      );
    }
    return (
      <Alert color="yellow" title="No grown-up available to sign off">
        No configured teacher resolves to a grown-up on the household roster, so there is
        nobody who may {action}. Check the <strong>teachers:</strong> list in school.yml and
        each member&apos;s <strong>birthyear</strong> in <strong>Household → Members</strong>.
      </Alert>
    );
  }

  const picker = (
    <Group align="end" gap="sm">
      <Select
        label={label}
        placeholder="Choose your profile"
        data={adults.map((u) => ({ value: u.id, label: u.name }))}
        value={grader ? grader.id : null}
        onChange={onChange}
        allowDeselect={false}
        w={240}
      />
      {onPinChange && (
        <PasswordInput
          label="Teacher PIN"
          placeholder="If configured"
          value={pin ?? ''}
          onChange={(e) => onPinChange(e.currentTarget.value)}
          w={140}
        />
      )}
    </Group>
  );

  // Nobody claimed yet: say it once, loudly, at the top. A quiet line of helper
  // text next to a dropdown is easy to scroll past, and the whole page is inert
  // until this is answered — that is worth an alert.
  if (!grader) {
    return (
      <Alert color="orange" title="Say who you are first">
        <Text size="sm" mb="xs">
          {graderId
            ? 'The remembered profile is no longer a grown-up on this roster — choose again.'
            : `Nothing can be signed off until a grown-up says they are the one about to ${action}.`}
        </Text>
        {picker}
      </Alert>
    );
  }

  return (
    <Group gap="sm" align="flex-end" wrap="wrap">
      {picker}
    </Group>
  );
}
