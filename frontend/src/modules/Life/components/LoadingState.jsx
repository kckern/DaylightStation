import { Center, Stack, Loader, Text } from '@mantine/core';
export function LoadingState({ label }) {
  return (
    <Center mih={160}>
      <Stack gap="xs" align="center">
        <Loader size="md" />
        {label && <Text size="sm" c="dimmed">{label}</Text>}
      </Stack>
    </Center>
  );
}
