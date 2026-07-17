import { Paper, Group, Title } from '@mantine/core';
export function SectionCard({ title, icon: Icon, actions, children, ...rest }) {
  return (
    <Paper {...rest}>
      {(title || actions) && (
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            {Icon && <Icon size={16} />}
            {title && <Title order={5}>{title}</Title>}
          </Group>
          {actions}
        </Group>
      )}
      {children}
    </Paper>
  );
}
