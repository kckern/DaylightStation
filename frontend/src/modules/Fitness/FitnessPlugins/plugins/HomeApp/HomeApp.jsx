import React from 'react';
import { Button, Center, Stack, Title } from '@mantine/core';

const HomeApp = () => {
  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <Center style={{ height: '100%', width: '100%' }}>
      <Stack align="center" spacing="xl">
        <Title order={2} style={{ color: 'white' }}>Fitness Dashboard</Title>
        <Button 
          size="xl" 
          variant="outline" 
          color="blue"
          onClick={handleRefresh}
        >
          Refresh Page
        </Button>
      </Stack>
    </Center>
  );
};

export default HomeApp;
