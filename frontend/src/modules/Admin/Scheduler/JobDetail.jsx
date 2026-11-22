import React, { useLayoutEffect, useRef, useState } from 'react';
import { FormDialog } from '@/lib/ui/FormDialog.jsx';
import { ConfirmModal, EmptyState, ErrorState, LoadingState, SubmitButton, useRetryRegion, useSheetSubmission } from '@/lib/ui';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Text, Badge, Button, Paper, Alert,
  TextInput, NumberInput, Divider, Code, Anchor
} from '@mantine/core';
import {
  IconArrowBack, IconPlayerPlay, IconEdit, IconTrash, IconAlertCircle, IconClock
} from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { ADMIN_SCHEDULER_JOBS_PATH, schedulerJobPath, triggerSchedulerJob } from '../../../hooks/admin/useAdminScheduler.js';
import { invalidateApiResources, useApiResource } from '../../../lib/hooks/useApiResource.js';
import { notifySuccess, notifyFailure } from '../shared/feedback.js';
import { statusBadgeColor } from '../utils/constants.js';
import { cronToHuman } from '../utils/formatters.js';

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString();
}

function StatusBadge({ runtime }) {
  if (!runtime || !runtime.status) {
    return <Badge color="gray" variant="light">never run</Badge>;
  }
  return <Badge color={statusBadgeColor(runtime.status)} variant="light">{runtime.status}</Badge>;
}

function InfoRow({ label, children }) {
  return (
    <Group gap="md" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" w={120} style={{ flexShrink: 0 }}>{label}</Text>
      <div>{children}</div>
    </Group>
  );
}

function refreshJobConfiguration(path) {
  invalidateApiResources(key => key === ADMIN_SCHEDULER_JOBS_PATH || key === path);
}

function JobDetail() {
  const { jobId } = useParams();
  return <JobDetailView key={jobId} jobId={jobId} />;
}

function JobDetailView({ jobId }) {
  const navigate = useNavigate();
  const path = schedulerJobPath(jobId);
  const { data, loading, error: readError, reload, refresh } = useApiResource(path);
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const job = data?.job ?? (data?.id ? data : null);
  const [actionError, setActionError] = useState(null);
  const mounted = useRef(false);
  const cancelRunDelay = useRef(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelRunDelay.current?.();
    };
  }, []);
  const { run: submitRun, saving: runQueued } = useSheetSubmission(null, error => {
    if (!mounted.current) return;
    const message = error.message || 'Failed to trigger job';
    setActionError(message);
    notifyFailure({ title: 'Trigger failed', message });
  });

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', module: '', schedule: '', dependencies: '', window: 0 });
  const closeEdit = () => setEditOpen(false);
  const { submit: submitEdit, saving: editSaving, failure: editFailure, clearFailure: clearEditFailure } = useSheetSubmission(() => {
    closeEdit();
    setActionError(null);
  });

  // Delete modal state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { run: submitDelete, saving: deleteLoading } = useSheetSubmission(() => {
    notifySuccess({ title: 'Job deleted', message: jobId });
    navigate('/admin/system/scheduler', { state: { focusJobs: true } });
  }, error => {
    if (!mounted.current) return;
    const message = error.message || 'Failed to delete job';
    setActionError(message);
    notifyFailure({ title: 'Delete failed', message });
    setDeleteOpen(false);
  });

  const handleRunNow = () => submitRun(async () => {
    setActionError(null);
    await triggerSchedulerJob(jobId);
    if (!mounted.current) return;
    notifySuccess({ title: 'Job triggered', message: jobId });
    // Allow runtime status to update before reading the queued job again.
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 2000);
      cancelRunDelay.current = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    cancelRunDelay.current = null;
    if (!mounted.current) return;
    try {
      await refresh({ followSuperseding: true });
    } catch {
      // The job reader reports a refused GET and offers its own Retry.
    }
  }, { valid: !loading && !readError, onSuccess: null });

  const openEditModal = () => {
    if (!job) return;
    setEditForm({
      name: job.name || '',
      module: job.module || '',
      schedule: job.schedule || '',
      dependencies: Array.isArray(job.dependencies) ? job.dependencies.join(', ') : (job.dependencies || ''),
      window: job.window || 0
    });
    clearEditFailure();
    setEditOpen(true);
  };

  const setEditField = (field, value) => {
    if (!editSaving) setEditForm(previous => ({ ...previous, [field]: value }));
  };

  const handleEditSave = event => submitEdit(event, async () => {
    const dependencies = editForm.dependencies.split(',').map(dependency => dependency.trim()).filter(Boolean);
    const minutes = Number(editForm.window);
    const window = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
    await DaylightAPI(path, { ...editForm, dependencies, window }, 'PUT');
    refreshJobConfiguration(path);
  });

  const handleDelete = () => submitDelete(async () => {
    await DaylightAPI(path, {}, 'DELETE');
    refreshJobConfiguration(path);
  });

  const runtime = job?.runtime || null;
  const details = job && (
    <>
      <Text size="xl" fw={700}>{job.name || job.id}</Text>

      {actionError && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Error"
          withCloseButton
          onClose={() => setActionError(null)}
        >
          {actionError}
        </Alert>
      )}

      {/* Job Info */}
      <Paper withBorder p="md">
        <Text size="sm" fw={600} mb="sm">Job Info</Text>
        <Stack gap="xs">
          <InfoRow label="ID">
            <Text size="sm"><Code>{job.id}</Code></Text>
          </InfoRow>
          <InfoRow label="Module">
            <Text size="sm">{job.module || 'N/A'}</Text>
          </InfoRow>
          <InfoRow label="Schedule">
            <Group gap="xs">
              <Text size="sm">{cronToHuman(job.schedule)}</Text>
              <Code>{job.schedule}</Code>
            </Group>
          </InfoRow>
          <InfoRow label="Dependencies">
            {Array.isArray(job.dependencies) && job.dependencies.length > 0 ? (
              <Group gap={4}>
                {job.dependencies.map((dep, i) => (
                  <Badge key={i} size="sm" variant="outline">{dep}</Badge>
                ))}
              </Group>
            ) : (
              <Text size="sm" c="dimmed">None</Text>
            )}
          </InfoRow>
          <InfoRow label="Window">
            <Text size="sm">{job.window != null ? `${job.window} min` : 'N/A'}</Text>
          </InfoRow>
        </Stack>
      </Paper>

      {/* Runtime Status */}
      <Paper withBorder p="md">
        <Group gap="xs" mb="sm">
          <IconClock size={16} />
          <Text size="sm" fw={600}>Runtime Status</Text>
        </Group>
        <Stack gap="xs">
          <InfoRow label="Status">
            <StatusBadge runtime={runtime} />
          </InfoRow>
          <InfoRow label="Last Run">
            <Text size="sm">{runtime ? formatDate(runtime.last_run) : 'N/A'}</Text>
          </InfoRow>
          <InfoRow label="Next Run">
            <Text size="sm">{runtime ? formatDate(runtime.nextRun) : 'N/A'}</Text>
          </InfoRow>
          <InfoRow label="Duration">
            <Text size="sm">{runtime?.duration_ms != null ? `${runtime.duration_ms} ms` : 'N/A'}</Text>
          </InfoRow>
          {runtime?.error && (
            <InfoRow label="Error">
              <Code block color="red" style={{ whiteSpace: 'pre-wrap' }}>
                {runtime.error}
              </Code>
            </InfoRow>
          )}
        </Stack>
      </Paper>

      {/* Actions */}
      <Divider />
      <Group gap="sm">
        <SubmitButton
          as={Button}
          type="button"
          leftSection={<IconPlayerPlay size={16} />}
          variant="light"
          onClick={handleRunNow}
          pending={runQueued}
          blocked={loading || Boolean(readError)}
        >
          {runQueued ? 'Queued' : 'Run Now'}
        </SubmitButton>
        <Button
          leftSection={<IconEdit size={16} />}
          variant="default"
          onClick={openEditModal}
        >
          Edit
        </Button>
        <Button
          leftSection={<IconTrash size={16} />}
          color="red"
          variant="outline"
          onClick={() => setDeleteOpen(true)}
        >
          Delete
        </Button>
      </Group>

      {/* Edit Modal */}
      <FormDialog
        opened={editOpen}
        onClose={closeEdit}
        closeOnEscape={!editSaving}
        closeOnClickOutside={!editSaving}
        closeButtonProps={{ disabled: editSaving }}
        title="Edit Job"
        centered
        size="md"
      >
        <Stack component="form" gap="sm" onSubmit={handleEditSave}>
          {editFailure && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" title="Save Error">
              {editFailure.message || 'Failed to save changes'}
            </Alert>
          )}
          <TextInput
            label="Name"
            value={editForm.name}
            readOnly={editSaving}
            onChange={event => setEditField('name', event.currentTarget.value)}
          />
          <TextInput
            label="Module"
            value={editForm.module}
            readOnly={editSaving}
            onChange={event => setEditField('module', event.currentTarget.value)}
          />
          <TextInput
            label="Schedule (cron)"
            description="Standard 5-field cron expression"
            value={editForm.schedule}
            readOnly={editSaving}
            onChange={event => setEditField('schedule', event.currentTarget.value)}
          />
          <TextInput
            label="Dependencies"
            description="Comma-separated list of job IDs"
            value={editForm.dependencies}
            readOnly={editSaving}
            onChange={event => setEditField('dependencies', event.currentTarget.value)}
          />
          <NumberInput
            label="Window (minutes)"
            value={editForm.window}
            readOnly={editSaving}
            onChange={value => setEditField('window', value || 0)}
            min={0}
          />
          <Group justify="flex-end" gap="sm" mt="md">
            <Button type="button" variant="subtle" onClick={closeEdit} disabled={editSaving}>
              Cancel
            </Button>
            <SubmitButton as={Button} pending={editSaving}>
              Save
            </SubmitButton>
          </Group>
        </Stack>
      </FormDialog>

      {/* Delete Confirmation */}
      <ConfirmModal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Job"
        message={`Are you sure you want to delete the job "${job.name || job.id}"? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteLoading}
      />
    </>
  );

  return (
    <Stack gap="md">
      <Anchor component={Link} to="/admin/system/scheduler" size="sm"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <IconArrowBack size={14} aria-hidden="true" /> Back to Scheduler
      </Anchor>
      <Stack component="section" gap="md" aria-label="Scheduler job" {...regionProps}>
        {readError && <ErrorState error={readError} label="Scheduler job" onRetry={retry} />}
        {!job && loading && <LoadingState label="scheduler job" />}
        {!job && !loading && !readError && <EmptyState title="Scheduler job not found" />}
        {details}
      </Stack>
    </Stack>
  );
}

export default JobDetail;
