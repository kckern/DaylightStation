import React, { useState, useEffect } from 'react';
import { MantineProvider, Paper, Title, Group, Text, Alert, Grid } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";
import { DaylightAPI } from '../lib/api.mjs';
import FitnessUsers from '../modules/Fitness/FitnessUsers.jsx';
import FitnessMenu from '../modules/Fitness/FitnessMenu.jsx';

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
          <FitnessMenu />
        </div>
      </div>
    </MantineProvider>
  );
};

export default FitnessApp;
