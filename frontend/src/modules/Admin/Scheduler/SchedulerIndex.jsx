import React, { useLayoutEffect, useState, useMemo, useRef } from 'react';
import { FormDialog } from '@/lib/ui/FormDialog.jsx';
import { SubmitButton } from '@/lib/ui/SubmitButton.jsx';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Stack, Text, Table, Badge, Button, Group, TextInput, Center, Alert, Anchor }  from '@mantine/core';
import { IconPlus, IconPlayerPlay, IconAlertCircle, IconClock } from '@tabler/icons-react';
import { ADMIN_SCHEDULER_JOBS_PATH, useAdminScheduler } from '../../../hooks/admin/useAdminScheduler.js';
import { useAdminRoster } from '../shared/useAdminRoster.js';
import { ErrorState, LoadingState } from '../../../lib/ui/states.jsx';
import { useFocusAfterRemoval, useRetryRegion } from '../../../lib/ui/useRetryRegion.js';
import { cronToHuman, formatDuration } from '../utils/formatters.js';

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
const EMPTY_JOBS = [];
const BAND_LABELS = {
  Frequent: 'Frequent (Sub-hourly)',
  Hourly: 'Hourly',
  Daily: 'Daily',
  Other: 'Other'
};

function SchedulerIndex() {
  const navigate = useNavigate();
  const { key: visit, state } = useLocation();
  const navigationType = useNavigationType();
  const { error, createJob, triggerJob, clearError } = useAdminScheduler();
  const { data, loading, error: readError, refresh, invalidateAfterWrite, refreshAfterWrite } = useAdminRoster(ADMIN_SCHEDULER_JOBS_PATH);
  const [retrying, setRetrying] = useState(false);
  const { regionProps, focus, retry } = useRetryRegion(retryRoster, loading || retrying);
  const rosterRef = regionProps.ref;
  const focusHandlers = useFocusAfterRemoval(focus);
  const focusJobs = state?.focusJobs;
  useLayoutEffect(() => {
    if (navigationType === 'PUSH' && focusJobs) rosterRef.current?.focus({ preventScroll: true });
  }, [visit, navigationType, focusJobs, rosterRef]);
  const jobs = Array.isArray(data) ? data : (data?.jobs ?? EMPTY_JOBS);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ id: '', name: '', module: '', schedule: '' });
  const [createErrors, setCreateErrors] = useState({});
  const [creating, setCreating] = useState(false);
  const [triggeringIds, setTriggeringIds] = useState(() => new Set());
  const pendingRuns = useRef(new Set());

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

  async function retryRoster() {
    setRetrying(true);
    try {
      await refresh({ followSuperseding: true });
    } catch {
      // The read region presents its current error.
    } finally {
      setRetrying(false);
    }
  }

  const handleCreateSubmit = async () => {
    if (creating || !validateCreateForm()) return;
    clearError();
    setCreating(true);
    try {
      await createJob({
        id: createForm.id.trim(),
        name: createForm.name.trim(),
        module: createForm.module.trim() || undefined,
        schedule: createForm.schedule.trim()
      });
      setCreateModalOpen(false);
      setCreateForm({ id: '', name: '', module: '', schedule: '' });
      setCreateErrors({});
      invalidateAfterWrite();
    } catch {
      // The command hook reports the write error.
    } finally {
      setCreating(false);
    }
  };

  const handleTrigger = async jobId => {
    if (retrying || readError || pendingRuns.current.has(jobId)) return;
    pendingRuns.current.add(jobId);
    setTriggeringIds(new Set(pendingRuns.current));
    clearError();
    try {
      await triggerJob(jobId);
      await refreshAfterWrite({ followSuperseding: true });
    } catch {
      // Command and roster errors are reported by their respective hooks.
    } finally {
      pendingRuns.current.delete(jobId);
      setTriggeringIds(new Set(pendingRuns.current));
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" className="ds-page-header">
        <span className="ds-page-title">Scheduler Jobs</span>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setCreateModalOpen(true)}
          disabled={creating}
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
      <Stack component="section" gap="lg" aria-label="Scheduler jobs" {...regionProps} {...focusHandlers}>
        {readError && <ErrorState error={readError} label="Scheduler jobs" onRetry={retry} />}
        {loading && jobs.length === 0 && <LoadingState label="scheduler jobs" />}

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
                  const jobLink = `/admin/system/scheduler/${encodeURIComponent(job.id)}`;
                  const status = job.runtime?.status || job.lastRun?.status || job.status || null;
                  const lastRunTime = job.runtime?.last_run || job.lastRun?.completedAt || job.lastRun?.startedAt || job.lastRunAt || null;
                  const durationMs = job.runtime?.duration_ms ?? job.lastRun?.duration_ms ?? job.duration_ms ?? null;
                  const errorMsg = status === 'failed' ? (job.runtime?.error || job.lastRun?.error || job.error || null) : null;

                  return (
                    <Table.Tr
                      key={job.id}
                      style={{ cursor: 'pointer' }}
                      onClick={event => {
                        if (!event.target.closest('a, button')) navigate(jobLink);
                      }}
                    >
                      <Table.Td>
                        <Anchor component={Link} to={jobLink} c="inherit" size="sm" fw={500}>{job.name || job.id}</Anchor>
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
                        <SubmitButton
                          as={Button}
                          type="button"
                          size="xs"
                          variant="light"
                          leftSection={<IconPlayerPlay size={14} />}
                          pending={triggeringIds.has(job.id)}
                          blocked={retrying || Boolean(readError)}
                          onClick={() => handleTrigger(job.id)}
                        >
                          Run
                        </SubmitButton>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Stack>
        ))}

        {jobs.length === 0 && !loading && !readError && (
          <Center h="40vh">
            <Stack align="center">
              <IconClock size={48} stroke={1} color="gray" />
              <Text c="dimmed">No scheduler jobs found. Create one to get started.</Text>
            </Stack>
          </Center>
        )}
      </Stack>

      {/* Create Job Modal */}
      <FormDialog
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
      </FormDialog>
    </Stack>
  );
}

export default SchedulerIndex;
