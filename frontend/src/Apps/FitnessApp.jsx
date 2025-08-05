import React, { useState, useEffect } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";
import { DaylightAPI } from '../lib/api.mjs';

const FitnessApp = () => {
  const [fitnessMessage, setFitnessMessage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFitnessData = async () => {
      try {
        const response = await DaylightAPI('/api/fitness');
        setFitnessMessage(response);
      } catch (error) {
        console.error('Error fetching fitness data:', error);
        setFitnessMessage({ message: 'Error loading fitness data', status: 'error' });
      } finally {
        setLoading(false);
      }
    };

    fetchFitnessData();
  }, []);
  return (
    <MantineProvider theme={{ colorScheme: 'dark' }}>
      <div className="fitness-app-container" >
        <div className="fitness-app-viewport">
          <Group position="apart" mb="md">
            <Title order={2} c="white">Fitness TV</Title>
          </Group>
          
          {loading ? (
            <Text c="white">Loading fitness data...</Text>
          ) : fitnessMessage ? (
            <Alert color={fitnessMessage.status === 'success' ? 'green' : 'red'} mb="md">
              <Text c="white">{fitnessMessage.message}</Text>
            </Alert>
          ) : null}
        </div>
      </div>
    </MantineProvider>
  );
};

export default FitnessApp;
