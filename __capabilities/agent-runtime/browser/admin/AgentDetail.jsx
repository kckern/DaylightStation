// frontend/src/modules/Admin/Agents/AgentDetail.jsx

import React, { useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Tabs, Group, Select, Text, Stack, Loader } from '@mantine/core';
import { IconSettings, IconLayoutDashboard, IconAdjustments } from '@tabler/icons-react';
import { useApiResource } from "../../../../frontend/src/lib/hooks/useApiResource.js";
import OverviewTab from "./OverviewTab.jsx";
import ConfigTab from "./ConfigTab.jsx";
import "./AgentDetail.scss";

function AgentDetail({ DashboardView }) {
  const { agentId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = location.hash.slice(1) || 'overview';
  const { data, loading: usersLoading } = useApiResource('/api/v1/admin/household');
  const users = (data?.members || []).map(member => ({
    value: member.username || member.id,
    label: member.display_name || member.username || member.id,
  }));
  const [selectedUser, setSelectedUser] = useState();
  const userId = selectedUser === undefined ? users[0]?.value ?? null : selectedUser;

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
          {usersLoading ? (
            <Loader size="xs" />
          ) : (
            <Select
              size="xs"
              w={180}
              value={userId}
              onChange={setSelectedUser}
              data={users}
              placeholder="Select user"
            />
          )}
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
          <Tabs.Tab value="dashboards" leftSection={<IconLayoutDashboard size={16} />}>
            Dashboards
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <OverviewTab agentId={agentId} userId={userId} />
        </Tabs.Panel>

        <Tabs.Panel value="config" pt="md">
          <ConfigTab agentId={agentId} userId={userId} />
        </Tabs.Panel>

        <Tabs.Panel value="dashboards" pt="md">
          <DashboardView agentId={agentId} userId={userId} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default AgentDetail;
