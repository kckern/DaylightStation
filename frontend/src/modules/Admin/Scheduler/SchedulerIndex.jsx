import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stack, Text, Table, Badge, Button, Group, Modal,
  TextInput, Loader, Center, Alert, UnstyledButton
} from '@mantine/core';
import { IconPlus, IconPlayerPlay, IconAlertCircle, IconClock } from '@tabler/icons-react';
import { useAdminScheduler } from '../../../hooks/admin/useAdminScheduler.js';

/**
 * Convert a cron expression to a human-readable string.
 */
function cronToHuman(expr) {
  if (!expr) return '';
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [min, hour, dayOfMonth] = parts;

  if (min.startsWith('*/')) return `Every ${min.slice(2)} min`;
  if (min !== '*' && hour === '*') return `Hourly at :${min.padStart(2, '0')}`;
  if (min !== '*' && hour !== '*' && dayOfMonth === '*') {
    const h = parseInt(hour);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:${min.padStart(2, '0')} ${ampm}`;
  }
  return expr;
}

/**
 * Classify a cron schedule into a frequency band for grouping.
 */
function getFrequencyBand(schedule) {
  if (!schedule) return 'Other';
  if (schedule.includes('*/')) return 'Frequent';
  const parts = schedule.split(' ');
  if (parts.length !== 5) return 'Other';
  if (parts[1] === '*') return 'Hourly';
  if (parts[2] === '*') return 'Daily';
  return 'Other';
}

/**
 * Format a timestamp as a relative or absolute time string.
 */
function formatLastRun(isoString) {
  if (!isoString) return 'Never';
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Get a Badge color for a job status.
 */
function statusBadgeColor(status) {
  if (status === 'success') return 'green';
  if (status === 'failed') return 'red';
  return 'gray';
}

/**
 * Frequency band display order and labels.
 */
const BAND_ORDER = ['Frequent', 'Hourly', 'Daily', 'Other'];
const BAND_LABELS = {
  Frequent: 'Frequent (Sub-hourly)',
  Hourly: 'Hourly',
  Daily: 'Daily',
  Other: 'Other'
};

function SchedulerIndex() {
  const navigate = useNavigate();
  const { jobs, loading, error, fetchJobs, createJob, triggerJob, clearError } = useAdminScheduler();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ id: '', name: '', module: '', schedule: '' });
  const [createErrors, setCreateErrors] = useState({});
  const [creating, setCreating] = useState(false);
  const [triggeringId, setTriggeringId] = useState(null);

  useEffect(() => {
    fetchJobs().catch(() => {});
  }, [fetchJobs]);

  // Group jobs by frequency band
  const groupedJobs = useMemo(() => {
    const groups = {};
    jobs.forEach(job => {
      const band = getFrequencyBand(job.schedule);
      if (!groups[band]) groups[band] = [];
      groups[band].push(job);
    });
    return BAND_ORDER
      .filter(band => groups[band]?.length > 0)
      .map(band => ({ band, label: BAND_LABELS[band], jobs: groups[band] }));
  }, [jobs]);

  const handleCreateFormChange = (field, value) => {
    setCreateForm(prev => ({ ...prev, [field]: value }));
    // Clear field error on change
    if (createErrors[field]) {
      setCreateErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validateCreateForm = () => {
    const errors = {};
    if (!createForm.id.trim()) errors.id = 'ID is required';
    if (!createForm.name.trim()) errors.name = 'Name is required';
    if (!createForm.schedule.trim()) errors.schedule = 'Schedule is required';
    setCreateErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateSubmit = async () => {
    if (!validateCreateForm()) return;
    setCreating(true);
    try {
      await createJob({
        id: createForm.id.trim(),
        name: createForm.name.trim(),
        module: createForm.module.trim() || undefined,
        schedule: createForm.schedule.trim()
      });
      await fetchJobs();
      setCreateModalOpen(false);
      setCreateForm({ id: '', name: '', module: '', schedule: '' });
      setCreateErrors({});
    } catch {
      // error is set in the hook
    } finally {
      setCreating(false);
    }
  };

  const handleTrigger = async (e, jobId) => {
    e.stopPropagation();
    setTriggeringId(jobId);
    try {
      await triggerJob(jobId);
      await fetchJobs();
    } catch {
      // error is set in the hook
    } finally {
      setTriggeringId(null);
    }
  };

  const handleRowClick = (jobId) => {
    navigate(`/admin/system/scheduler/${jobId}`);
  };

  if (loading && jobs.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text size="xl" fw={600}>Scheduler Jobs</Text>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setCreateModalOpen(true)}
        >
          Create Job
        </Button>
      </Group>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Error"
          withCloseButton
          onClose={clearError}
        >
          {error.message || 'Failed to load scheduler jobs'}
        </Alert>
      )}

      {groupedJobs.map(group => (
        <Stack key={group.band} gap="xs">
          <Group gap="xs">
            <IconClock size={16} stroke={1.5} />
            <Text size="sm" fw={600} c="dimmed" tt="uppercase">
              {group.label}
            </Text>
          </Group>

          <Table highlightOnHover withTableBorder withColumnBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Schedule</Table.Th>
                <Table.Th>Last Run</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Duration</Table.Th>
                <Table.Th style={{ width: 100 }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {group.jobs.map(job => {
                const status = job.lastRun?.status || job.status || null;
                const lastRunTime = job.lastRun?.completedAt || job.lastRun?.startedAt || job.lastRunAt || null;
                const durationMs = job.lastRun?.duration_ms ?? job.duration_ms ?? null;
                const errorMsg = status === 'failed' ? (job.lastRun?.error || job.error || null) : null;

                return (
                  <Table.Tr
                    key={job.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleRowClick(job.id)}
                  >
                    <Table.Td>
                      <Text size="sm" fw={500}>{job.name || job.id}</Text>
                      {errorMsg && (
                        <Text size="xs" c="red" lineClamp={1}>{errorMsg}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{cronToHuman(job.schedule)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{formatLastRun(lastRunTime)}</Text>
                    </Table.Td>
                    <Table.Td>
                      {status ? (
                        <Badge color={statusBadgeColor(status)} variant="light" size="sm">
                          {status}
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="light" size="sm">never run</Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{formatDuration(durationMs)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconPlayerPlay size={14} />}
                        loading={triggeringId === job.id}
                        onClick={(e) => handleTrigger(e, job.id)}
                      >
                        Run
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Stack>
      ))}

      {jobs.length === 0 && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <IconClock size={48} stroke={1} color="gray" />
            <Text c="dimmed">No scheduler jobs found. Create one to get started.</Text>
          </Stack>
        </Center>
      )}

      {/* Create Job Modal */}
      <Modal
        opened={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateErrors({});
        }}
        title="Create Scheduler Job"
      >
        <Stack gap="md">
          <TextInput
            label="ID"
            placeholder="my-job-id"
            required
            value={createForm.id}
            onChange={(e) => handleCreateFormChange('id', e.currentTarget.value)}
            error={createErrors.id}
          />
          <TextInput
            label="Name"
            placeholder="My Job"
            required
            value={createForm.name}
            onChange={(e) => handleCreateFormChange('name', e.currentTarget.value)}
            error={createErrors.name}
          />
          <TextInput
            label="Module"
            placeholder="path/to/module.mjs"
            value={createForm.module}
            onChange={(e) => handleCreateFormChange('module', e.currentTarget.value)}
          />
          <TextInput
            label="Schedule"
            placeholder="*/10 * * * *"
            required
            value={createForm.schedule}
            onChange={(e) => handleCreateFormChange('schedule', e.currentTarget.value)}
            error={createErrors.schedule}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSubmit} loading={creating}>
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default SchedulerIndex;
