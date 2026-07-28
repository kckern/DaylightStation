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
import { Alert, Group, Select, Text } from '@mantine/core';

/**
 * @param {object} props
 * @param {object[]} props.adults
 * @param {string|null} props.graderId
 * @param {object|null} props.grader
 * @param {(id: string|null) => void} props.onChange
 * @param {string} props.action - what the sign-in unlocks, for the empty-state copy
 */
export default function GraderBar({ adults, graderId, grader, onChange, action = 'sign off' }) {
  if (!adults.length) {
    return (
      <Alert color="yellow" title="No grown-up on the roster">
        Nobody in the household roster has a <strong>birthyear</strong> that makes them 18 or
        over, so there is nobody who may {action}. Add or correct a birthyear in{' '}
        <strong>Household → Members</strong>. A profile with no birthyear is treated as a child.
      </Alert>
    );
  }

  return (
    <Group gap="sm" align="flex-end" wrap="wrap">
      <Select
        label="Marking as"
        placeholder="Choose your profile"
        data={adults.map((u) => ({ value: u.id, label: u.name }))}
        value={grader ? grader.id : null}
        onChange={onChange}
        allowDeselect={false}
        w={240}
      />
      {!grader && (
        <Text size="sm" c="orange" pb={6}>
          {graderId
            ? 'The remembered profile is no longer a grown-up on this roster — choose again.'
            : `Choose your profile before you ${action}.`}
        </Text>
      )}
    </Group>
  );
}
