import React, { useState, useEffect } from 'react';
import { Text, Skeleton } from '@mantine/core';
import { getWidgetRegistry } from '../../../../../../screen-framework/widgets/registry.js';
import { useScreen } from '../../../../../../screen-framework/providers/ScreenProvider.jsx';

export default function FitnessSessionDetailWidget({ sessionId }) {
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { restore } = useScreen();

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/v1/fitness/sessions/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSessionData(data.session || data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
        <Skeleton height={20} width="40%" />
        <Skeleton height="100%" style={{ flex: 1 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <Text c="red" size="sm">Failed to load session: {error}</Text>
        <Text
          size="sm"
          c="dimmed"
          mt="md"
          style={{ cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => restore('right-area')}
        >
          Back to dashboard
        </Text>
      </div>
    );
  }

  const registry = getWidgetRegistry();
  const ChartComponent = registry.get('fitness:chart');
  if (!ChartComponent) {
    return <Text c="dimmed" ta="center" py="xl">Chart component not available</Text>;
  }

  return <ChartComponent sessionData={sessionData} mode="standalone" />;
}
