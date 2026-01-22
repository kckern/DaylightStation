import React, { useState, useEffect, useMemo } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert } from '@mantine/core';
import '@mantine/core/styles.css';
import "./HealthApp.scss";
import Nutrition from '../modules/Health/Nutrition';
import { DaylightAPI } from '../lib/api.mjs';
import { getChildLogger } from '../lib/logging/singleton.js';

const HealthApp = () => {
  const logger = useMemo(() => getChildLogger({ app: 'health' }), []);
  const [healthMessage, setHealthMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHealthData = async () => {
      try {
        const response = await DaylightAPI('/api/v1/health/status');
        setHealthMessage(response);
      } catch (error) {
        logger.error('health.fetch.failed', { message: error?.message, name: error?.name });
        setHealthMessage({ message: 'Error loading health data', status: 'error' });
      } finally {
        setLoading(false);
      }
    };

    fetchHealthData();
  }, []);
  return (
    <MantineProvider>
      <Paper
        shadow="md"
        radius="md"
        p="lg"
        withBorder
        style={{ minHeight: '100vh', minWidth: '100vw', boxSizing: 'border-box', margin: '2rem' }}
      >
        <Group position="apart" mb="md">
          <Title order={2}>Health App</Title>
        </Group>
        
        {loading ? (
          <Text>Loading health data...</Text>
        ) : healthMessage ? (
          <Alert color={!!healthMessage.message ? 'green' : 'red'} mb="md">
            {healthMessage.message}
          </Alert>
        ) : null}
        
        <Nutrition />
      </Paper>
    </MantineProvider>
  );
};

export default HealthApp;
