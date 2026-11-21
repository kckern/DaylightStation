// frontend/src/modules/Admin/Agents/AgentDetail.jsx

import React, { useEffect, useState, useCallback, useId } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Tabs, Group, Select, Text, Stack, Loader, Button } from '@mantine/core';
import { IconSettings, IconLayoutDashboard, IconAdjustments } from '@tabler/icons-react';
import { useApiResource } from "../../../../frontend/src/lib/hooks/useApiResource.js";
import { useRetryRegion } from "../../../../frontend/src/lib/ui/useRetryRegion.js";
import OverviewTab from "./OverviewTab.jsx";
import "./AgentDetail.scss";

function AgentDetail({ agentId: explicitAgentId, ConfigView, DashboardView }) {
  const { agentId: routeAgentId } = useParams();
  const agentId = explicitAgentId ?? routeAgentId;
  const location = useLocation();
  const navigate = useNavigate();

  const requestedTab = location.hash.slice(1);
  const memberSelectId = useId();
  const hasConfigView = Boolean(ConfigView);
  const hasDashboardView = Boolean(DashboardView);
  const requestedTabUnsupported = (requestedTab === 'config' && !hasConfigView)
    || (requestedTab === 'dashboards' && !hasDashboardView);
  const activeTab = requestedTabUnsupported ? 'overview' : requestedTab || 'overview';

  useEffect(() => {
    if (requestedTabUnsupported) navigate('#overview', { replace: true });
  }, [requestedTabUnsupported, navigate]);
  const {
    data,
    hasResult: hasUsersResult,
    loading: usersLoading,
    error: usersError,
    reload: reloadUsers,
  } = useApiResource('/api/v1/admin/household');
  const users = (data?.members || []).map(member => ({
    value: member.username || member.id,
    label: member.display_name || member.username || member.id,
  }));
  const [selectedUser, setSelectedUser] = useState();
  const userId = selectedUser === null
    ? null
    : users.some(user => user.value === selectedUser)
      ? selectedUser
      : users[0]?.value ?? null;
  const { regionProps, retry: retryUsers } = useRetryRegion(reloadUsers, usersLoading);

  // Sync tab to URL hash
  const handleTabChange = useCallback((tab) => {
    navigate(`#${tab}`, { replace: true });
  }, [navigate]);

  return (
    <Stack p="md" gap="md" className="agent-detail">
      {/* Header */}
      <Group justify="space-between">
        <Text component="h1" size="xl" fw={600} ff="var(--ds-font-mono)">{agentId}</Text>
        <Group gap="sm">
          <Text component="label" htmlFor={memberSelectId} size="sm" c="dimmed">User:</Text>
          <Group gap="xs" {...regionProps}>
            {users.length > 0 ? (
              <Select
                id={memberSelectId}
                size="xs"
                w={180}
                value={userId}
                onChange={setSelectedUser}
                data={users}
                placeholder="Select user"
              />
            ) : usersLoading ? (
              <Loader size="xs" />
            ) : hasUsersResult && !usersError ? (
              <Text size="xs" c="dimmed">No household members available</Text>
            ) : null}
            {usersError && (
              <Group gap="xs" role="alert">
                <Text size="xs" c="red">Couldn’t load household members</Text>
                <Button size="xs" variant="subtle" loading={usersLoading} onClick={retryUsers}>
                  Retry
                </Button>
              </Group>
            )}
          </Group>
        </Group>
      </Group>

      {/* Tabs */}
      <Tabs value={activeTab} onChange={handleTabChange}>
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconSettings size={16} />}>
            Overview
          </Tabs.Tab>
          {hasConfigView && (
            <Tabs.Tab value="config" leftSection={<IconAdjustments size={16} />}>
              Config
            </Tabs.Tab>
          )}
          {hasDashboardView && (
            <Tabs.Tab value="dashboards" leftSection={<IconLayoutDashboard size={16} />}>
              Dashboards
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <OverviewTab agentId={agentId} userId={userId} />
        </Tabs.Panel>

        {hasConfigView && (
          <Tabs.Panel value="config" pt="md">
            <ConfigView agentId={agentId} userId={userId} />
          </Tabs.Panel>
        )}

        {hasDashboardView && (
          <Tabs.Panel value="dashboards" pt="md">
            <DashboardView agentId={agentId} userId={userId} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

export default AgentDetail;
