import React from 'react';
import { useLocation } from 'react-router-dom';
import { Group, Burger, Text, Anchor, Box } from '@mantine/core';
import { Link } from 'react-router-dom';

function AdminHeader({ opened, toggle }) {
  const location = useLocation();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, idx) => {
    const path = '/' + pathParts.slice(0, idx + 1).join('/');
    const label = part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ');
    const isLast = idx === pathParts.length - 1;

    return (
      <React.Fragment key={path}>
        {idx > 0 && (
          <Text
            component="span"
            size="12px"
            c="var(--ds-text-muted)"
            ff="var(--ds-font-mono)"
            mx={6}
          >
            /
          </Text>
        )}
        {isLast ? (
          <Text
            component="span"
            size="12px"
            fw={500}
            ff="var(--ds-font-mono)"
            c="var(--ds-text-primary)"
          >
            {label}
          </Text>
        ) : (
          <Anchor
            component={Link}
            to={path}
            size="12px"
            ff="var(--ds-font-mono)"
            c="var(--ds-text-secondary)"
            underline="never"
          >
            {label}
          </Anchor>
        )}
      </React.Fragment>
    );
  });

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
        <Box style={{ display: 'flex', alignItems: 'center' }}>
          {breadcrumbs}
        </Box>
      </Group>
      <div />
    </Group>
  );
}

export default AdminHeader;
