import React, { useState } from 'react';
import { FormDialog } from '@/lib/ui/FormDialog.jsx';
import { useNavigate } from 'react-router-dom';
import { Stack, Text, Table, Badge, Button, Group, TextInput, Select, NumberInput, Center, Alert, Paper, Divider }  from '@mantine/core';
import { IconPlus, IconAlertCircle, IconUsers, IconTrash } from '@tabler/icons-react';
import { ADMIN_HOUSEHOLD_PATH, useAdminHousehold } from '../../../hooks/admin/useAdminHousehold.js';
import { useAdminRoster } from '../shared/useAdminRoster.js';
import { ErrorState, LoadingState } from '../../../lib/ui/states.jsx';
import { useRetryRegion } from '../../../lib/ui/useRetryRegion.js';
import ConfirmModal from '../shared/ConfirmModal.jsx';

const TYPE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'family_member', label: 'Family Member' }
];

const GROUP_OPTIONS = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' }
];

/**
 * Get a Badge color for a member type.
 */
function typeBadgeColor(type) {
  if (type === 'owner') return 'blue';
  if (type === 'family_member') return 'teal';
  return 'gray';
}

/**
 * Get a Badge color for a member group.
 */
function groupBadgeColor(group) {
  if (group === 'primary') return 'violet';
  if (group === 'secondary') return 'orange';
  return 'gray';
}

function MembersIndex() {
  const navigate = useNavigate();
  const { error, createMember, removeMember, clearError } = useAdminHousehold();
  const { data, loading, error: readError, reload, invalidateAfterWrite, refreshAfterWrite } = useAdminRoster(ADMIN_HOUSEHOLD_PATH);
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const household = data?.household;
  const members = data?.members ?? [];

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    display_name: '',
    type: 'family_member',
    group: 'primary',
    birthyear: null
  });
  const [createErrors, setCreateErrors] = useState({});
  const [creating, setCreating] = useState(false);

  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

  const handleCreateFormChange = (field, value) => {
    setCreateForm(prev => ({ ...prev, [field]: value }));
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
    if (!createForm.username.trim()) errors.username = 'Username is required';
    setCreateErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateSubmit = async () => {
    if (creating || !validateCreateForm()) return;
    clearError();
    setCreating(true);
    try {
      const payload = {
        username: createForm.username.trim(),
        display_name: createForm.display_name.trim() || undefined,
        type: createForm.type,
        group: createForm.group,
        birthyear: createForm.birthyear || undefined
      };
      await createMember(payload);
      setCreateModalOpen(false);
      setCreateForm({
        username: '',
        display_name: '',
        type: 'family_member',
        group: 'primary',
        birthyear: null
      });
      setCreateErrors({});
      invalidateAfterWrite();
    } catch {
      // The command hook reports the write error.
    } finally {
      setCreating(false);
    }
  };

  const handleRemoveClick = (e, member) => {
    e.stopPropagation();
    setRemoveTarget(member);
  };

  const handleRemoveConfirm = async () => {
    if (!removeTarget) return;
    clearError();
    setRemoving(true);
    try {
      await removeMember(removeTarget.username);
      setRemoveTarget(null);
      await refreshAfterWrite();
    } catch {
      // Command and roster errors are reported by their respective hooks.
    } finally {
      setRemoving(false);
    }
  };

  const handleRowClick = (username) => {
    navigate(`/admin/household/members/${username}`);
  };

  return (
    <Stack gap="lg">
      {/* Household settings panel */}
      {household && (
        <Paper p="md" withBorder>
          <Stack gap="sm">
            <Group gap="xs">
              <IconUsers size={18} stroke={1.5} />
              <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                Household Settings
              </Text>
            </Group>
            <Divider />
            <Group grow>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">Household Name</Text>
                <Text size="sm" fw={500}>{household.name || household.household_id}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">Head of Household</Text>
                <Text size="sm" fw={500}>{household.head || 'Not set'}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">Total Members</Text>
                <Text size="sm" fw={500}>{members.length}</Text>
              </Stack>
            </Group>
          </Stack>
        </Paper>
      )}

      {/* Header with Add button */}
      <Group justify="space-between" className="ds-page-header">
        <span className="ds-page-title">Household Members</span>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setCreateModalOpen(true)}
          disabled={creating}
        >
          Add Member
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
          {error.message || 'Failed to load household data'}
        </Alert>
      )}
      <Stack component="section" gap="lg" aria-label="Household members" {...regionProps}>
        {readError && <ErrorState error={readError} label="Household members" onRetry={retry} />}
        {loading && members.length === 0 && <LoadingState label="household members" />}

        {/* Members table */}
        {members.length > 0 && (
          <Table highlightOnHover withTableBorder withColumnBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Display Name</Table.Th>
                <Table.Th>Username</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Group</Table.Th>
                <Table.Th style={{ width: 100 }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.map(member => (
                <Table.Tr
                  key={member.username}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleRowClick(member.username)}
                >
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {member.display_name || member.username}
                    </Text>
                    {member.birthyear && (
                      <Text size="xs" c="dimmed">Born {member.birthyear}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">{member.username}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={typeBadgeColor(member.type)}
                      variant="light"
                      size="sm"
                    >
                      {member.type === 'family_member' ? 'Family Member' : member.type || 'unknown'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={groupBadgeColor(member.group)}
                      variant="light"
                      size="sm"
                    >
                      {member.group_label || member.group || 'unknown'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={(e) => handleRemoveClick(e, member)}
                      disabled={removing}
                    >
                      Remove
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        {members.length === 0 && !loading && !readError && (
          <Center h="40vh">
            <Stack align="center">
              <IconUsers size={48} stroke={1} color="gray" />
              <Text c="dimmed">No household members found. Add one to get started.</Text>
            </Stack>
          </Center>
        )}
      </Stack>

      {/* Add Member Modal */}
      <FormDialog
        opened={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateErrors({});
        }}
        title="Add Household Member"
      >
        <Stack gap="md">
          <TextInput
            label="Username"
            placeholder="johndoe"
            required
            value={createForm.username}
            onChange={(e) => handleCreateFormChange('username', e.currentTarget.value)}
            error={createErrors.username}
          />
          <TextInput
            label="Display Name"
            placeholder="John Doe"
            value={createForm.display_name}
            onChange={(e) => handleCreateFormChange('display_name', e.currentTarget.value)}
          />
          <Select
            label="Type"
            data={TYPE_OPTIONS}
            value={createForm.type}
            onChange={(value) => handleCreateFormChange('type', value)}
          />
          <Select
            label="Group"
            data={GROUP_OPTIONS}
            value={createForm.group}
            onChange={(value) => handleCreateFormChange('group', value)}
          />
          <NumberInput
            label="Birth Year"
            placeholder="2000"
            value={createForm.birthyear}
            onChange={(value) => handleCreateFormChange('birthyear', value)}
            min={1900}
            max={new Date().getFullYear()}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSubmit} loading={creating}>
              Add Member
            </Button>
          </Group>
        </Stack>
      </FormDialog>

      {/* Remove Member Confirmation */}
      <ConfirmModal
        opened={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemoveConfirm}
        title="Remove Member"
        message={`Are you sure you want to remove "${removeTarget?.display_name || removeTarget?.username}" from the household? This will not delete their profile.`}
        confirmLabel="Remove"
        loading={removing}
      />
    </Stack>
  );
}

export default MembersIndex;
