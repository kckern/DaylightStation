import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Text, Title, Stack, Badge, Group, TextInput, Button, Skeleton } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

export default function NutritionCard({ nutrition, onRefresh, onClick }) {
  const logger = useMemo(() => getLogger().child({ component: 'NutritionCard' }), []);
  const [inputState, setInputState] = useState('idle'); // idle | parsing | review
  const [inputText, setInputText] = useState('');
  const [reviewItems, setReviewItems] = useState([]);
  const [recentCatalog, setRecentCatalog] = useState([]);

  // Load recent catalog for quick-add chips
  useEffect(() => {
    DaylightAPI('/api/v1/health/nutrition/catalog/recent?limit=5')
      .then(res => {
        setRecentCatalog(res?.items || []);
        logger.debug('nutrition.catalog.loaded', { count: res?.items?.length || 0 });
      })
      .catch(err => {
        logger.warn('nutrition.catalog.load_failed', { error: err?.message });
      });
  }, [inputState]); // refresh after input cycle

  const handleSubmit = useCallback(async () => {
    if (!inputText.trim()) return;
    setInputState('parsing');
    logger.info('nutrition.input.submit', { text: inputText.trim() });
    try {
      const result = await DaylightAPI('/api/v1/health/nutrition/input', {
        type: 'text',
        content: inputText.trim(),
      }, 'POST');
      const items = result?.items || result?.messages || [];
      setReviewItems(items);
      setInputState('review');
      logger.info('nutrition.input.parsed', { itemCount: items.length });
    } catch (err) {
      logger.error('nutrition.input.failed', { error: err?.message });
      setInputState('idle');
    }
  }, [inputText]);

  const handleAccept = useCallback(() => {
    logger.info('nutrition.input.accepted', { itemCount: reviewItems.length });
    setInputText('');
    setReviewItems([]);
    setInputState('idle');
    onRefresh?.();
  }, [onRefresh, reviewItems.length, logger]);

  const handleUndo = useCallback(() => {
    logger.info('nutrition.input.undone');
    setInputText('');
    setReviewItems([]);
    setInputState('idle');
  }, [logger]);

  const handleQuickAdd = useCallback(async (entryId) => {
    try {
      await DaylightAPI('/api/v1/health/nutrition/catalog/quickadd', {
        catalogEntryId: entryId,
      }, 'POST');
      logger.info('nutrition.quickadd.success', { catalogEntryId: entryId });
      onRefresh?.();
    } catch (err) {
      logger.warn('nutrition.quickadd.failed', { catalogEntryId: entryId, error: err?.message });
    }
  }, [onRefresh, logger]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleSubmit();
  }, [handleSubmit]);

  // --- Review state ---
  if (inputState === 'review') {
    return (
      <DashboardCard title="Nutrition" icon="🍽️">
        <Stack gap="xs">
          {reviewItems.map((item, i) => (
            <div key={i} className="nutrition-review__item">
              <Text size="sm">{item.text || item.name || item.label || JSON.stringify(item)}</Text>
            </div>
          ))}
          <div className="nutrition-review__actions">
            <Button size="xs" color="green" onClick={handleAccept}>Accept</Button>
            <Button size="xs" color="gray" variant="outline" onClick={handleUndo}>Undo</Button>
          </div>
        </Stack>
      </DashboardCard>
    );
  }

  // --- Parsing state ---
  if (inputState === 'parsing') {
    return (
      <DashboardCard title="Nutrition" icon="🍽️">
        <Stack gap="xs" align="center" py="md">
          <Skeleton height={16} width="60%" />
          <Text size="xs" c="dimmed">Analyzing...</Text>
        </Stack>
      </DashboardCard>
    );
  }

  // --- Idle state ---
  const cals = nutrition?.calories;

  return (
    <DashboardCard title="Nutrition" icon="🍽️" onClick={onClick}>
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">
          {cals != null ? Math.round(cals) : '—'}
        </Title>
        <Text size="sm" c="dimmed">calories</Text>
        {nutrition && (
          <Group gap={4} justify="center">
            {nutrition.protein != null && <Badge color="blue" variant="light" size="sm">P {Math.round(nutrition.protein)}g</Badge>}
            {nutrition.carbs != null && <Badge color="yellow" variant="light" size="sm">C {Math.round(nutrition.carbs)}g</Badge>}
            {nutrition.fat != null && <Badge color="orange" variant="light" size="sm">F {Math.round(nutrition.fat)}g</Badge>}
          </Group>
        )}
      </Stack>

      <div className="nutrition-input" onClick={(e) => e.stopPropagation()}>
        <TextInput
          placeholder="Log food..."
          size="xs"
          value={inputText}
          onChange={(e) => setInputText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          styles={{ input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' } }}
        />
        {recentCatalog.length > 0 && (
          <div className="nutrition-input__chips">
            {recentCatalog.map((entry) => (
              <Badge
                key={entry.id}
                size="xs"
                variant="outline"
                color="gray"
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); handleQuickAdd(entry.id); }}
              >
                {entry.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
