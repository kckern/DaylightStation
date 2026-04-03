import React, { useState, useEffect } from 'react';
import { Text, Stack, Group, Paper, TextInput, Badge } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';

export default function NutritionDetail({ dashboard }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const history = dashboard?.history?.daily || [];

  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await DaylightAPI(`/api/v1/health/nutrition/catalog?q=${encodeURIComponent(searchQuery)}&limit=10`);
        setSearchResults(res?.items || []);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const recentDays = history.filter(d => d.nutrition?.calories != null).slice(0, 14);

  return (
    <Stack gap="md" mt="md">
      <div>
        <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">Search Catalog</Text>
        <TextInput
          placeholder="Search foods..."
          size="xs"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          styles={{ input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' } }}
        />
        {searchResults.length > 0 && (
          <Stack gap={4} mt="xs">
            {searchResults.map(item => (
              <Paper key={item.id} p="xs" radius="sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <Group justify="space-between">
                  <Text size="sm">{item.name}</Text>
                  <Group gap="xs">
                    <Badge size="xs" color="gray">{item.nutrients?.calories || 0} cal</Badge>
                    <Text size="xs" c="dimmed">×{item.useCount}</Text>
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </div>

      <div>
        <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">Recent Days</Text>
        {recentDays.map(day => (
          <Paper key={day.date} p="xs" radius="sm" mb={4} style={{ background: 'rgba(255,255,255,0.03)' }}>
            <Group justify="space-between">
              <Text size="sm">{day.date}</Text>
              <Text size="sm" fw={600}>{Math.round(day.nutrition.calories)} cal</Text>
            </Group>
          </Paper>
        ))}
      </div>
    </Stack>
  );
}
