import { createContext, useContext } from 'react';
import { Stack, Group, Title } from '@mantine/core';

export const LifePageScrollRef = createContext(null);

export function LifePage({ title, titleRef, actions, children, scrollReady = true }) {
  const contentRef = useContext(LifePageScrollRef);
  return (
    <Stack gap="md" ref={scrollReady ? contentRef : null}>
      {(title || actions) && (
        <Group justify="space-between" align="center">
          {title ? <Title order={2} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>{title}</Title> : <span />}
          {actions}
        </Group>
      )}
      {children}
    </Stack>
  );
}
