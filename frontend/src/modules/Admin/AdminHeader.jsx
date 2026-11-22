import React from 'react';
import { useLocation } from 'react-router-dom';
import { Group, Burger, Text, Anchor, Box } from '@mantine/core';
import GuardedLink from './shared/GuardedLink.jsx';

function AdminHeader({ opened, toggle, opener }) {
  const location = useLocation();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, idx) => {
    const path = '/' + pathParts.slice(0, idx + 1).join('/');
    // A path segment is URL-encoded (a review permalink's `cue:va1` arrives as `cue%3Ava1`): show it decoded.
    let text = part;
    try { text = decodeURIComponent(part); } catch { /* a malformed escape stays as typed */ }
    const label = text.charAt(0).toUpperCase() + text.slice(1).replace(/-/g, ' ');
    const isLast = idx === pathParts.length - 1;

    return (
      <React.Fragment key={path}>
        {idx > 0 && (
          <Text
            component="span"
            aria-hidden="true"
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
            aria-current="page"
            size="12px"
            fw={500}
            ff="var(--ds-font-mono)"
            c="var(--ds-text-primary)"
          >
            {label}
          </Text>
        ) : (
          <Anchor
            component={GuardedLink}
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
    <Group h="100%" px="md" gap="sm" wrap="nowrap">
      <Burger ref={opener} aria-label="Toggle admin navigation" aria-expanded={opened} opened={opened} onClick={toggle} className="admin-navigation-toggle" size="sm" />
      <Box component="nav" aria-label="Breadcrumb" className="admin-breadcrumbs">
        {breadcrumbs}
      </Box>
    </Group>
  );
}

export default AdminHeader;
