import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Text, Badge, Button, Paper, Alert, Center, Loader,
  Modal, TextInput, NumberInput, Divider, Code, Anchor
} from '@mantine/core';
import {
  IconArrowBack, IconPlayerPlay, IconEdit, IconTrash, IconAlertCircle, IconClock
} from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';
import ConfirmModal from '../shared/ConfirmModal.jsx';

function cronToHuman(expr) {
  if (!expr) return '';
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [min, hour] = parts;
  if (min.startsWith('*/')) return `Every ${min.slice(2)} min`;
  if (min !== '*' && hour === '*') return `Hourly at :${min.padStart(2, '0')}`;
  if (min !== '*' && hour !== '*') {
    const h = parseInt(hour);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:${min.padStart(2, '0')} ${ampm}`;
  }
  return expr;
}

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
  if (runtime.status === 'success') {
    return <Badge color="green" variant="light">success</Badge>;
  }
  if (runtime.status === 'failed') {
    return <Badge color="red" variant="light">failed</Badge>;
  }
  return <Badge color="gray" variant="light">{runtime.status}</Badge>;
}

function InfoRow({ label, children }) {
  return (
    <Group gap="md" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" w={120} style={{ flexShrink: 0 }}>{label}</Text>
      <div>{children}</div>
    </Group>
  );
}

function JobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [runQueued, setRunQueued] = useState(false);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', module: '', schedule: '', dependencies: '', window: 0 });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  // Delete modal state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchJob = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`/api/v1/admin/scheduler/jobs/${jobId}`);
      setJob(result.job);
    } catch (err) {
      setError(err.message || 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  const handleRunNow = useCallback(async () => {
    setRunQueued(true);
    try {
      await DaylightAPI(`/api/v1/admin/scheduler/jobs/${jobId}/run`, {}, 'POST');
      // Re-fetch to update runtime status after a short delay
      setTimeout(() => {
        fetchJob();
        setRunQueued(false);
      }, 2000);
    } catch (err) {
      setError(err.message || 'Failed to trigger job');
      setRunQueued(false);
    }
  }, [jobId, fetchJob]);

  const openEditModal = useCallback(() => {
    if (!job) return;
    setEditForm({
      name: job.name || '',
      module: job.module || '',
      schedule: job.schedule || '',
      dependencies: Array.isArray(job.dependencies) ? job.dependencies.join(', ') : (job.dependencies || ''),
      window: job.window || 0
    });
    setEditError(null);
    setEditOpen(true);
  }, [job]);

  const handleEditSave = useCallback(async () => {
    setEditSaving(true);
    setEditError(null);
    try {
      const deps = editForm.dependencies
        ? editForm.dependencies.split(',').map(d => d.trim()).filter(Boolean)
        : [];
      await DaylightAPI(`/api/v1/admin/scheduler/jobs/${jobId}`, {
        name: editForm.name,
        module: editForm.module,
        schedule: editForm.schedule,
        dependencies: deps,
        window: editForm.window
      }, 'PUT');
      setEditOpen(false);
      await fetchJob();
    } catch (err) {
      setEditError(err.message || 'Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  }, [jobId, editForm, fetchJob]);

  const handleDelete = useCallback(async () => {
    setDeleteLoading(true);
    try {
      await DaylightAPI(`/api/v1/admin/scheduler/jobs/${jobId}`, {}, 'DELETE');
      navigate('/admin/system/scheduler');
    } catch (err) {
      setError(err.message || 'Failed to delete job');
      setDeleteLoading(false);
      setDeleteOpen(false);
    }
  }, [jobId, navigate]);

  // Loading state
  if (loading && !job) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  // Error / 404 state (no job loaded)
  if (error && !job) {
    return (
      <Stack gap="md">
        <Anchor
          size="sm"
          onClick={() => navigate('/admin/system/scheduler')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <IconArrowBack size={14} /> Back to Scheduler
        </Anchor>
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error}
        </Alert>
      </Stack>
    );
  }

  if (!job) return null;

  const runtime = job.runtime || null;

  return (
    <Stack gap="md">
      {/* Header */}
      <Anchor
        size="sm"
        onClick={() => navigate('/admin/system/scheduler')}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <IconArrowBack size={14} /> Back to Scheduler
      </Anchor>

      <Text size="xl" fw={700}>{job.name || job.id}</Text>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Error"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
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
        <Button
          leftSection={<IconPlayerPlay size={16} />}
          variant="light"
          onClick={handleRunNow}
          disabled={runQueued}
        >
          {runQueued ? 'Queued' : 'Run Now'}
        </Button>
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
      <Modal
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Job"
        centered
        size="md"
      >
        <Stack gap="sm">
          {editError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" title="Save Error">
              {editError}
            </Alert>
          )}
          <TextInput
            label="Name"
            value={editForm.name}
            onChange={(e) => setEditForm(prev => ({ ...prev, name: e.currentTarget.value }))}
          />
          <TextInput
            label="Module"
            value={editForm.module}
            onChange={(e) => setEditForm(prev => ({ ...prev, module: e.currentTarget.value }))}
          />
          <TextInput
            label="Schedule (cron)"
            description="Standard 5-field cron expression"
            value={editForm.schedule}
            onChange={(e) => setEditForm(prev => ({ ...prev, schedule: e.currentTarget.value }))}
          />
          <TextInput
            label="Dependencies"
            description="Comma-separated list of job IDs"
            value={editForm.dependencies}
            onChange={(e) => setEditForm(prev => ({ ...prev, dependencies: e.currentTarget.value }))}
          />
          <NumberInput
            label="Window (minutes)"
            value={editForm.window}
            onChange={(val) => setEditForm(prev => ({ ...prev, window: val || 0 }))}
            min={0}
          />
          <Group justify="flex-end" gap="sm" mt="md">
            <Button variant="subtle" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} loading={editSaving}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

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
    </Stack>
  );
}

export default JobDetail;
