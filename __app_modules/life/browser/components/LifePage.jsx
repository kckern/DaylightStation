import { Stack, Group, Title } from '@mantine/core';
export function LifePage({ title, actions, children }) {
  return (
    <Stack gap="md">
      {(title || actions) && (
        <Group justify="space-between" align="center">
          {title ? <Title order={2}>{title}</Title> : <span />}
          {actions}
        </Group>
      )}
      {children}
    </Stack>
  );
}
