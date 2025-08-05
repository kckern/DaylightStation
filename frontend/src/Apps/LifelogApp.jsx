import React, { useState, useEffect } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert } from '@mantine/core';
import '@mantine/core/styles.css';
import "./LifelogApp.scss";
import Nutrition from '../modules/Health/Nutrition';
import { DaylightAPI } from '../lib/api.mjs';

const LifelogApp = () => {
  const [lifelogMessage, setLifelogMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLifelogData = async () => {
      try {
        const response = await DaylightAPI('/lifelog');
        setLifelogMessage(response);
      } catch (error) {
        console.error('Error fetching lifelog data:', error);
        setLifelogMessage({ message: 'Error loading lifelog data', status: 'error' });
      } finally {
        setLoading(false);
      }
    };

    fetchLifelogData();
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
          <Title order={2}>Lifelog App</Title>
        </Group>
        
        {loading ? (
          <Text>Loading lifelog data...</Text>
        ) : lifelogMessage ? (
          <Alert color={lifelogMessage.status === 'success' ? 'green' : 'red'} mb="md">
            {lifelogMessage.message}
          </Alert>
        ) : null}
        

      </Paper>
    </MantineProvider>
  );
};

export default LifelogApp;
