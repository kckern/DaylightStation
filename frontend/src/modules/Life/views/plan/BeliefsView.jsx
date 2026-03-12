import { useState } from 'react';
import { Stack, Paper, Title, Text, Group, Badge, Progress, Button, TextInput, Select, Modal } from '@mantine/core';
import { IconFlask } from '@tabler/icons-react';
import { useBeliefs } from '../../hooks/useLifePlan.js';

function confidenceColor(c) {
  if (c >= 0.8) return 'green';
  if (c >= 0.5) return 'yellow';
  return 'red';
}

function stateColor(state) {
  const map = {
    hypothesized: 'blue', testing: 'cyan', confirmed: 'green',
    refuted: 'red', questioning: 'yellow', dormant: 'gray',
    cascade_questioning: 'orange', cascade_refuted: 'red', archived: 'dark',
  };
  return map[state] || 'gray';
}

function EvidenceTimeline({ history = [] }) {
  if (history.length === 0) return <Text size="xs" c="dimmed">No evidence yet</Text>;

  const recent = history.slice(-5).reverse();
  return (
    <Stack gap={4}>
      {recent.map((e, i) => (
        <Group key={i} gap="xs">
          <Badge size="xs" color={e.type === 'confirmation' ? 'green' : e.type === 'disconfirmation' ? 'red' : 'yellow'}>
            {e.type}
          </Badge>
          <Text size="xs" c="dimmed">{e.date || 'undated'}</Text>
          {e.note && <Text size="xs">{e.note}</Text>}
        </Group>
      ))}
    </Stack>
  );
}

export function BeliefsView({ username }) {
  const { beliefs, loading, addEvidence } = useBeliefs(username);
  const [addingTo, setAddingTo] = useState(null);
  const [evidenceType, setEvidenceType] = useState('confirmation');
  const [evidenceNote, setEvidenceNote] = useState('');

  if (loading) return null;

  const handleAddEvidence = async () => {
    if (!addingTo) return;
    await addEvidence(addingTo, {
      type: evidenceType,
      note: evidenceNote,
      date: new Date().toISOString().slice(0, 10),
    });
    setAddingTo(null);
    setEvidenceNote('');
  };

  return (
    <Stack gap="md">
      <Title order={4}>Beliefs</Title>

      {beliefs.length === 0 && (
        <Text size="sm" c="dimmed">No beliefs defined yet.</Text>
      )}

      <Stack gap="sm">
        {beliefs.map(b => {
          const effectiveConf = b.effective_confidence ?? b.confidence ?? 0;
          return (
            <Paper key={b.id} p="sm" withBorder>
              <Group justify="space-between" mb="xs">
                <Stack gap={2} style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>
                    If {b.if_hypothesis || b.id}
                  </Text>
                  {b.then_expectation && (
                    <Text size="xs" c="dimmed">Then {b.then_expectation}</Text>
                  )}
                </Stack>
                <Group gap="xs">
                  <Badge color={stateColor(b.state)} variant="light" size="sm">
                    {b.state}
                  </Badge>
                  {b.foundational && (
                    <Badge color="violet" variant="filled" size="xs">foundational</Badge>
                  )}
                </Group>
              </Group>

              <Group gap="md" mb="xs">
                <Stack gap={2} style={{ flex: 1 }}>
                  <Group justify="space-between">
                    <Text size="xs">Confidence</Text>
                    <Text size="xs" fw={500}>{Math.round(effectiveConf * 100)}%</Text>
                  </Group>
                  <Progress
                    value={effectiveConf * 100}
                    color={confidenceColor(effectiveConf)}
                    size="sm"
                  />
                </Stack>
              </Group>

              <EvidenceTimeline history={b.evidence_history} />

              <Group mt="xs">
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconFlask size={14} />}
                  onClick={() => setAddingTo(b.id)}
                >
                  Add Evidence
                </Button>
              </Group>
            </Paper>
          );
        })}
      </Stack>

      <Modal opened={!!addingTo} onClose={() => setAddingTo(null)} title="Add Evidence">
        <Stack gap="sm">
          <Select
            label="Type"
            data={[
              { value: 'confirmation', label: 'Confirmation' },
              { value: 'disconfirmation', label: 'Disconfirmation' },
              { value: 'spurious', label: 'Spurious' },
            ]}
            value={evidenceType}
            onChange={setEvidenceType}
          />
          <TextInput
            label="Note"
            value={evidenceNote}
            onChange={(e) => setEvidenceNote(e.currentTarget.value)}
          />
          <Button onClick={handleAddEvidence}>Submit</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
