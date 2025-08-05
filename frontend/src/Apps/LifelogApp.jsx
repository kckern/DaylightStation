import React from 'react';
import { MantineProvider, Paper, Title, Group } from '@mantine/core';
import '@mantine/core/styles.css';
import "./LifelogApp.scss";
import Nutrition from '../modules/Health/Nutrition';

const LifelogApp = () => {
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
        <Nutrition />
      </Paper>
    </MantineProvider>
  );
};

export default LifelogApp;
