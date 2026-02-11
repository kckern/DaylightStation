import React from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { NavLink, Stack, Text, Divider } from '@mantine/core';
import {
  IconMenu2, IconPlayerRecord, IconCalendarEvent,
  IconRun, IconCoin, IconHeart, IconShoppingCart,
  IconUsers, IconDevices,
  IconPlugConnected, IconClock, IconFileCode
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
    <Stack gap="xs">
      {navSections.map((section, idx) => (
        <React.Fragment key={section.label}>
          {idx > 0 && <Divider my="xs" />}
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4}>
            {section.label}
          </Text>
          {section.items.map(item => (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              label={item.label}
              leftSection={<item.icon size={16} stroke={1.5} />}
              active={location.pathname.startsWith(item.to)}
              variant="light"
            />
          ))}
        </React.Fragment>
      ))}
    </Stack>
  );
}

export default AdminNav;
