import React from 'react';
import { MantineProvider, Paper, Title, Group } from '@mantine/core';
import '@mantine/core/styles.css';
import "./FitnessApp.scss";

const FitnessApp = () => {
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
          <Title order={2}>Fitness App</Title>
        </Group>
        <p>Placeholder for Fitness-related features.</p>
      </Paper>
    </MantineProvider>
  );
};

export default FitnessApp;
