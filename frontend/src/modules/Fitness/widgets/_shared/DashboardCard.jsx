import React from 'react';
import { Paper, Text, Group, Skeleton } from '@mantine/core';
import './DashboardCard.scss';

export function DashboardCard({ title, icon, children, className = '', onClick }) {
  return (
    <Paper
      className={`dashboard-card ${className}`}
      p="md"
      radius="md"
      onPointerDown={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e); } : undefined}
    >
      {title && (
        <Group gap="xs" mb="sm">
          {icon && <Text size="lg">{icon}</Text>}
          <Text size="sm" fw={600} tt="uppercase" c="dimmed">{title}</Text>
        </Group>
      )}
      {children}
    </Paper>
  );
}

export function DashboardCardSkeleton({ height = 150 }) {
  return (
    <Paper className="dashboard-card" p="md" radius="md">
      <Skeleton height={12} width="40%" mb="sm" />
      <Skeleton height={height - 40} />
    </Paper>
  );
}
