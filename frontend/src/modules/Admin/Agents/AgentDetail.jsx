// frontend/src/modules/Admin/Agents/AgentDetail.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Tabs, Group, Select, Text, Stack, Center, Loader } from '@mantine/core';
import { IconSettings, IconLayoutDashboard, IconAdjustments } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';
import OverviewTab from './OverviewTab.jsx';
import ConfigTab from './ConfigTab.jsx';
import DashboardsTab from './DashboardsTab.jsx';
import './AgentDetail.scss';

function AgentDetail() {
  const { agentId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Tab from URL hash
  const hashTab = location.hash?.replace('#', '') || 'overview';
  const [activeTab, setActiveTab] = useState(hashTab);

  // User selector
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(null);
  const [usersLoading, setUsersLoading] = useState(true);

  // Fetch household members for user selector
  // API: GET /api/v1/admin/household -> { household, members }
  // Each member has: username, display_name, etc.
  useEffect(() => {
    setUsersLoading(true);
    DaylightAPI('/api/v1/admin/household')
      .then(result => {
        const members = result.members || [];
        setUsers(members.map(m => ({
          value: m.username || m.id,
          label: m.display_name || m.username || m.id,
        })));
        // Default to first user
        if (members.length > 0 && !userId) {
          setUserId(members[0].username || members[0].id);
        }
      })
      .catch(() => {
        setUsers([]);
      })
      .finally(() => setUsersLoading(false));
  }, []);

  // Sync tab to URL hash
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
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
              onChange={setUserId}
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
          <DashboardsTab agentId={agentId} userId={userId} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default AgentDetail;
