import React from 'react';
import { Center, Stack, Title, Text, ThemeIcon } from '@mantine/core';
import { IconHammer } from '@tabler/icons-react';

function ComingSoon({ title = 'This Feature' }) {
  return (
    <Center h="60vh">
      <Stack align="center" gap="md">
        <ThemeIcon size={80} radius="xl" variant="light" color="gray">
          <IconHammer size={40} />
        </ThemeIcon>
        <Title order={2}>{title}</Title>
        <Text c="dimmed" ta="center" maw={400}>
          This section is under construction. Check back later for updates.
        </Text>
      </Stack>
    </Center>
  );
}

export default ComingSoon;
