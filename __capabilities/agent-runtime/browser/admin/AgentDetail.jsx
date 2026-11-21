// frontend/src/modules/Admin/Agents/AgentDetail.jsx

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Tabs, Group, Select, Text, Stack, Loader, Button } from '@mantine/core';
import { IconSettings, IconLayoutDashboard, IconAdjustments } from '@tabler/icons-react';
import { useApiResource } from "../../../../frontend/src/lib/hooks/useApiResource.js";
import { useRetryRegion } from "../../../../frontend/src/lib/ui/useRetryRegion.js";
import OverviewTab from "./OverviewTab.jsx";
import ConfigTab from "./ConfigTab.jsx";
import "./AgentDetail.scss";

function AgentDetail({ agentId: explicitAgentId, DashboardView }) {
  const { agentId: routeAgentId } = useParams();
  const agentId = explicitAgentId ?? routeAgentId;
  const location = useLocation();
  const navigate = useNavigate();

  const requestedTab = location.hash.slice(1);
  const hasDashboardView = Boolean(DashboardView);
  const activeTab = requestedTab === 'dashboards' && !hasDashboardView
    ? 'overview'
    : requestedTab || 'overview';

  useEffect(() => {
    if (requestedTab === 'dashboards' && !hasDashboardView) {
      navigate('#overview', { replace: true });
    }
  }, [requestedTab, hasDashboardView, navigate]);
  const {
    data,
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
        <Text size="xl" fw={600} ff="var(--ds-font-mono)">{agentId}</Text>
        <Group gap="sm">
          <Text size="sm" c="dimmed">User:</Text>
          <Group gap="xs" {...regionProps}>
            {users.length > 0 ? (
              <Select
                size="xs"
                w={180}
                value={userId}
                onChange={setSelectedUser}
                data={users}
                placeholder="Select user"
              />
            ) : usersLoading ? (
              <Loader size="xs" />
            ) : (
              <Text size="xs" c="dimmed">No household members available</Text>
            )}
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
          <Tabs.Tab value="config" leftSection={<IconAdjustments size={16} />}>
            Config
          </Tabs.Tab>
          {hasDashboardView && (
            <Tabs.Tab value="dashboards" leftSection={<IconLayoutDashboard size={16} />}>
              Dashboards
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <OverviewTab agentId={agentId} userId={userId} />
        </Tabs.Panel>

        <Tabs.Panel value="config" pt="md">
          <ConfigTab agentId={agentId} userId={userId} />
        </Tabs.Panel>

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
