import React, { useState, useEffect } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert } from '@mantine/core';
import '@mantine/core/styles.css';
import "./HealthApp.scss";
import Nutrition from '../modules/Health/Nutrition';
import { DaylightAPI } from '../lib/api.mjs';

const HealthApp = () => {
  const [healthMessage, setHealthMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHealthData = async () => {
      try {
        const response = await DaylightAPI('/health');
        setHealthMessage(response);
      } catch (error) {
        console.error('Error fetching health data:', error);
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
          <Alert color={healthMessage.status === 'success' ? 'green' : 'red'} mb="md">
            {healthMessage.message}
          </Alert>
        ) : null}
        
        <Nutrition />
      </Paper>
    </MantineProvider>
  );
};

export default HealthApp;
