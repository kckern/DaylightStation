import React from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { NavLink, Stack, Text, Box } from '@mantine/core';
import {
  IconMenu2, IconPlayerRecord, IconCalendarEvent,
  IconRun, IconCoin, IconHeart, IconShoppingCart,
  IconUsers, IconDevices,
  IconPlugConnected, IconClock, IconFileCode,
  IconRobot
} from '@tabler/icons-react';

const navSections = [
  {
    label: 'CONTENT',
    items: [
      { label: 'Menus', icon: IconMenu2, to: '/admin/content/lists/menus' },
      { label: 'Watchlists', icon: IconPlayerRecord, to: '/admin/content/lists/watchlists' },
      { label: 'Programs', icon: IconCalendarEvent, to: '/admin/content/lists/programs' },
    ]
  },
  {
    label: 'APPS',
    items: [
      { label: 'Fitness', icon: IconRun, to: '/admin/apps/fitness' },
      { label: 'Finance', icon: IconCoin, to: '/admin/apps/finance' },
      { label: 'Gratitude', icon: IconHeart, to: '/admin/apps/gratitude' },
      { label: 'Shopping', icon: IconShoppingCart, to: '/admin/apps/shopping' },
    ]
  },
  {
    label: 'AGENTS',
    items: [
      { label: 'All Agents', icon: IconRobot, to: '/admin/agents' },
    ]
  },
  {
    label: 'HOUSEHOLD',
    items: [
      { label: 'Members', icon: IconUsers, to: '/admin/household/members' },
      { label: 'Devices', icon: IconDevices, to: '/admin/household/devices' },
    ]
  },
  {
    label: 'SYSTEM',
    items: [
      { label: 'Integrations', icon: IconPlugConnected, to: '/admin/system/integrations' },
      { label: 'Scheduler', icon: IconClock, to: '/admin/system/scheduler' },
      { label: 'Config', icon: IconFileCode, to: '/admin/system/config' },
    ]
  }
];

function AdminNav() {
  const location = useLocation();

  return (
    <Stack gap={0} className="ds-nav">
      {/* Brand */}
      <Box className="ds-nav-brand" py="md" px="md" mb="sm">
        <Text
          ff="var(--ds-font-mono)"
          fw={600}
          size="sm"
          c="var(--ds-text-primary)"
          style={{ letterSpacing: '0.12em' }}
        >
          <span style={{ color: 'var(--ds-warning)' }}>&#9679;</span>{' '}DAYLIGHT
        </Text>
      </Box>

      {navSections.map((section) => (
        <Box key={section.label} mb="md">
          <Text
            className="ds-nav-section-label"
            size="10px"
            fw={500}
            ff="var(--ds-font-mono)"
            c="var(--ds-text-muted)"
            tt="uppercase"
            px="md"
            mb={4}
            style={{ letterSpacing: '0.15em' }}
          >
            {section.label}
          </Text>
          {section.items.map(item => {
            const isActive = location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                label={
                  <Text size="13px" fw={isActive ? 500 : 400} ff="var(--ds-font-body)">
                    {item.label}
                  </Text>
                }
                leftSection={
                  <item.icon
                    size={18}
                    stroke={1.5}
                    color={isActive ? 'var(--ds-accent)' : 'var(--ds-text-secondary)'}
                  />
                }
                active={isActive}
                variant="subtle"
                className={`ds-nav-item ${isActive ? 'ds-nav-item-active' : ''}`}
              />
            );
          })}
        </Box>
      ))}
    </Stack>
  );
}

export default AdminNav;
