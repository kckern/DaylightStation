import { Paper, Stack, Text, ThemeIcon } from '@mantine/core';
export function EmptyState({ icon: Icon, message, cta }) {
  return (
    <Paper p="xl">
      <Stack gap="sm" align="center">
        {Icon && <ThemeIcon variant="light" size={48} radius="xl" color="gray"><Icon size={26} /></ThemeIcon>}
        <Text c="dimmed" ta="center" maw={420}>{message}</Text>
        {cta}
      </Stack>
    </Paper>
  );
}
