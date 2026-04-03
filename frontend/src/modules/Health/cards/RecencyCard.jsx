import React from 'react';
import { Text } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';

export default function RecencyCard({ recency }) {
  if (!recency?.length) {
    return (
      <DashboardCard title="Self-Care" icon="🧠">
        <Text c="dimmed" ta="center" py="md">No data</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Self-Care" icon="🧠">
      <div className="recency-grid">
        {recency.map((item) => (
          <div key={item.source} className="recency-item">
            <div className={`recency-item__dot recency-item__dot--${item.status}`} />
            <div>
              <Text size="xs" fw={500}>{item.name}</Text>
              <Text size="xs" c="dimmed">
                {item.daysSince === 0 ? 'Today' : `${item.daysSince}d`}
              </Text>
            </div>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}
