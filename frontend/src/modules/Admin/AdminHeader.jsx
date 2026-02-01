import React from 'react';
import { useLocation } from 'react-router-dom';
import { Group, Burger, Text, Breadcrumbs, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';

function AdminHeader({ opened, toggle }) {
  const location = useLocation();

  // Build breadcrumbs from path
  const pathParts = location.pathname.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, idx) => {
    const path = '/' + pathParts.slice(0, idx + 1).join('/');
    const label = part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ');
    const isLast = idx === pathParts.length - 1;

    return isLast ? (
      <Text key={path} size="sm" fw={500}>{label}</Text>
    ) : (
      <Anchor key={path} component={Link} to={path} size="sm">
        {label}
      </Anchor>
    );
  });

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group>
        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
        <Text size="lg" fw={700}>DaylightStation</Text>
      </Group>

      <Breadcrumbs separator="›">
        {breadcrumbs}
      </Breadcrumbs>

      <div style={{ width: 100 }} /> {/* Spacer for balance */}
    </Group>
  );
}

export default AdminHeader;
