// frontend/src/modules/Media/browse/HomeView.jsx
// Landing surface: resume card (current session), recents, and config-driven
// category cards from the household media config. Resume/recents bind to the
// local session in Phase 2/3; their empty states render friendly hints, never
// nothing.
import React, { useState, useEffect } from 'react';
import { SimpleGrid, UnstyledButton, Skeleton, Text, Title, Stack, Alert } from '@mantine/core';
import { IconChevronRight, IconAlertCircle } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useNav } from '../shell/NavProvider.jsx';

function cardPath(entry) {
  return [entry.source, entry.mediaType].filter(Boolean).join('/');
}
function cardKey(entry) {
  return `${entry.source}-${entry.mediaType ?? 'all'}`;
}

export function HomeView() {
  const [browse, setBrowse] = useState(null);
  const [error, setError] = useState(null);
  const { push } = useNav();

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/media/config')
      .then((cfg) => {
        if (cancelled) return;
        setBrowse(Array.isArray(cfg?.browse) ? cfg.browse : []);
      })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Stack data-testid="home-view" className="home-view" gap="lg">
      {/* ResumeCard + RecentsRow mount here (Phases 2–3) */}
      <section>
        <Title order={2} mb="sm">Browse</Title>
        {error && (
          <Alert
            data-testid="home-error"
            color="red"
            variant="light"
            icon={<IconAlertCircle size={18} />}
          >
            {error.message}
          </Alert>
        )}
        {!error && !browse && (
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} data-testid="home-loading">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={88} radius="md" />)}
          </SimpleGrid>
        )}
        {!error && browse && browse.length === 0 && (
          <Text c="dimmed" data-testid="home-empty">
            No catalog categories configured. Add `browse` entries to the media app config.
          </Text>
        )}
        {!error && browse && browse.length > 0 && (
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
            {browse.map((entry) => (
              <UnstyledButton
                key={cardKey(entry)}
                data-testid={`home-card-${cardKey(entry)}`}
                className="home-card"
                onClick={() => push('browse', { path: cardPath(entry), label: entry.label })}
              >
                <span className="home-card-label">{entry.label}</span>
                <IconChevronRight size={18} aria-hidden />
              </UnstyledButton>
            ))}
          </SimpleGrid>
        )}
      </section>
    </Stack>
  );
}

export default HomeView;
