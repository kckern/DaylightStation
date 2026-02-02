import React from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { NavLink, Stack, Text, Divider } from '@mantine/core';
import {
  IconMenu2, IconPlayerRecord, IconCalendarEvent,
  IconDeviceTv, IconKeyboard, IconRun,
  IconUsers, IconDevices, IconHome,
  IconPlayerPlay, IconSettings
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
      { label: 'TV', icon: IconDeviceTv, to: '/admin/apps/tv' },
      { label: 'Office', icon: IconKeyboard, to: '/admin/apps/office' },
      { label: 'Fitness', icon: IconRun, to: '/admin/apps/fitness' },
    ]
  },
  {
    label: 'HOUSEHOLD',
    items: [
      { label: 'Users', icon: IconUsers, to: '/admin/household/users' },
      { label: 'Devices', icon: IconDevices, to: '/admin/household/devices' },
      { label: 'Rooms', icon: IconHome, to: '/admin/household/rooms' },
    ]
  },
  {
    label: 'SYSTEM',
    items: [
      { label: 'Playback', icon: IconPlayerPlay, to: '/admin/system/playback' },
      { label: 'Integrations', icon: IconSettings, to: '/admin/system/integrations' },
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
