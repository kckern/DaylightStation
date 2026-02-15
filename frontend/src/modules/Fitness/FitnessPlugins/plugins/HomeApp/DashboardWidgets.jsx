// frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx

import React from 'react';
import { Paper, Text, Title, Group, Stack, Badge, Progress, Skeleton } from '@mantine/core';

// ─── Shared card wrapper ───────────────────────────────────────

export function DashboardCard({ title, icon, children, className = '', onClick }) {
  return (
    <Paper
      className={`dashboard-card ${className}`}
      p="md"
      radius="md"
      onPointerDown={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e); } : undefined}
    >
      {title && (
        <Group gap="xs" mb="sm">
          {icon && <Text size="lg">{icon}</Text>}
          <Text size="sm" fw={600} tt="uppercase" c="dimmed">{title}</Text>
        </Group>
      )}
      {children}
    </Paper>
  );
}

export function DashboardCardSkeleton({ height = 150 }) {
  return (
    <Paper className="dashboard-card" p="md" radius="md">
      <Skeleton height={12} width="40%" mb="sm" />
      <Skeleton height={height - 40} />
    </Paper>
  );
}

// ─── Weight Trend Card ─────────────────────────────────────────

export function WeightTrendCard({ weight }) {
  if (!weight || weight.current == null) {
    return (
      <DashboardCard title="Weight" icon={null} className="dashboard-card--weight">
        <Text c="dimmed" ta="center" py="md">No weight data</Text>
      </DashboardCard>
    );
  }

  const trendArrow = weight.trend7d < 0 ? '↓' : weight.trend7d > 0 ? '↑' : '→';
  const trendColor = weight.trend7d < 0 ? 'green' : weight.trend7d > 0 ? 'red' : 'gray';

  return (
    <DashboardCard title="Weight" className="dashboard-card--weight">
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">
          {weight.current.toFixed(1)}
        </Title>
        <Text size="sm" c="dimmed">lbs</Text>
        {weight.trend7d != null && (
          <Badge color={trendColor} variant="light" size="lg">
            {trendArrow} {Math.abs(weight.trend7d).toFixed(1)} lbs / 7d
          </Badge>
        )}
        {weight.fatPercent != null && (
          <Text size="xs" c="dimmed">{weight.fatPercent.toFixed(1)}% body fat</Text>
        )}
      </Stack>
    </DashboardCard>
  );
}

// ─── Nutrition History Card ────────────────────────────────────

export function NutritionCard({ nutrition }) {
  if (!nutrition || !Array.isArray(nutrition) || nutrition.length === 0) {
    return (
      <DashboardCard title="Nutrition" className="dashboard-card--nutrition">
        <Text c="dimmed" ta="center" py="md">No nutrition data</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Nutrition (cal)" className="dashboard-card--nutrition">
      <Stack gap={4}>
        {nutrition.map((day) => (
          <Group key={day.date} justify="space-between" className="nutrition-row" wrap="nowrap">
            <Text size="xs" c="dimmed" w={70}>{formatDateShort(day.date)}</Text>
            <Text size="sm" fw={600} w={55} ta="right">{day.calories}</Text>
            <Group gap={4} style={{ flex: 1 }} justify="flex-end" wrap="nowrap">
              <Badge variant="light" size="xs" color="blue">{Math.round(day.protein)}p</Badge>
              <Badge variant="light" size="xs" color="yellow">{Math.round(day.carbs)}c</Badge>
              <Badge variant="light" size="xs" color="orange">{Math.round(day.fat)}f</Badge>
            </Group>
          </Group>
        ))}
      </Stack>
    </DashboardCard>
  );
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Recent Sessions Card ─────────────────────────────────────

export function WorkoutsCard({ sessions }) {
  if (!sessions || sessions.length === 0) {
    return (
      <DashboardCard title="Recent Sessions" className="dashboard-card--workouts">
        <Text c="dimmed" ta="center" py="md">No recent sessions</Text>
      </DashboardCard>
    );
  }

  // Group sessions by date
  const groups = [];
  let currentDate = null;
  for (const s of sessions) {
    if (s.date !== currentDate) {
      currentDate = s.date;
      groups.push({ date: s.date, label: formatDate(s.date), sessions: [] });
    }
    groups[groups.length - 1].sessions.push(s);
  }

  return (
    <DashboardCard title="Recent Sessions" className="dashboard-card--workouts">
      <Stack gap="xs">
        {groups.map((group) => (
          <div key={group.date}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" className="session-date-header">
              {group.label}
            </Text>
            {group.sessions.map((s) => (
              <Group key={s.sessionId} gap="sm" wrap="nowrap" className="session-row">
                <img
                  src={`/api/v1/display/plex/${s.media.mediaId}`}
                  alt=""
                  className="session-thumbnail"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>{s.media.title}</Text>
                  {s.media.showTitle && (
                    <Text size="xs" c="dimmed" truncate>{s.media.showTitle}</Text>
                  )}
                  <Group gap="xs" wrap="nowrap">
                    {s.durationMs && (
                      <Badge variant="light" size="xs">{Math.round(s.durationMs / 60000)} min</Badge>
                    )}
                    {s.totalCoins > 0 && (
                      <Badge variant="light" size="xs" color="yellow">{s.totalCoins} coins</Badge>
                    )}
                  </Group>
                  {s.participants?.length > 0 && (
                    <Group gap={6} className="session-avatars">
                      {s.participants.map((p) => (
                        <img
                          key={p.id}
                          src={`/api/v1/static/users/${p.id}`}
                          alt={p.displayName}
                          title={p.displayName}
                          className="session-avatar"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ))}
                    </Group>
                  )}
                </Stack>
                {s.media.grandparentId && (
                  <img
                    src={`/api/v1/display/plex/${s.media.grandparentId}`}
                    alt=""
                    className="session-poster"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
              </Group>
            ))}
          </div>
        ))}
      </Stack>
    </DashboardCard>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (dateStr === todayStr) return 'Today';
  if (dateStr === yesterdayStr) return 'Yesterday';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Up Next Card (curated content - "invisible elf") ──────────

export function UpNextCard({ curated, onPlay }) {
  if (!curated?.up_next?.primary) return null;

  const { primary, alternates } = curated.up_next;

  return (
    <DashboardCard className="dashboard-card--upnext">
      <Group gap="md" wrap="nowrap" align="flex-start">
        <ContentThumbnail contentId={primary.content_id} title={primary.title} />
        <Stack gap="xs" style={{ flex: 1 }}>
          {primary.program_context && (
            <Text size="xs" c="dimmed" tt="uppercase">{primary.program_context}</Text>
          )}
          <Title order={3}>{primary.title}</Title>
          <Group gap="xs">
            <Badge variant="light">{primary.duration} min</Badge>
          </Group>
          <div
            className="dashboard-play-btn"
            role="button"
            tabIndex={0}
            onPointerDown={(e) => { e.stopPropagation(); onPlay?.(primary); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay?.(primary); }}
          >
            <Text fw={700} size="lg">Play</Text>
          </div>
        </Stack>
      </Group>
      {alternates?.length > 0 && (
        <div className="upnext-alternates">
          <Text size="xs" c="dimmed" mt="md" mb="xs">Or try:</Text>
          <Group gap="xs">
            {alternates.map((alt, i) => (
              <Paper
                key={i}
                className="alternate-chip"
                p="xs"
                radius="sm"
                onPointerDown={() => onPlay?.(alt)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay?.(alt); }}
                role="button"
                tabIndex={0}
              >
                <Text size="sm">{alt.title}</Text>
                <Text size="xs" c="dimmed">{alt.duration} min</Text>
              </Paper>
            ))}
          </Group>
        </div>
      )}
    </DashboardCard>
  );
}

function ContentThumbnail({ contentId, title }) {
  const { source, localId } = parseContentIdInline(contentId);
  const thumbUrl = `/api/v1/display/${source}/${localId}`;

  return (
    <div className="content-thumbnail">
      <img
        src={thumbUrl}
        alt=""
        onError={(e) => { e.target.style.display = 'none'; }}
      />
    </div>
  );
}

function parseContentIdInline(contentId) {
  if (!contentId) return { source: 'plex', localId: '' };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return { source: contentId.slice(0, colonIdx).trim(), localId: contentId.slice(colonIdx + 1).trim() };
}

// ─── Coach Card ("talking to Santa") ───────────────────────────

export function CoachCard({ coach, liveNutrition, onCtaAction }) {
  if (!coach) return null;

  // Filter stale CTAs by checking live data
  const activeCtas = (coach.cta || []).filter(cta => {
    // If CTA says "no meals logged" but live data shows meals, suppress it
    if (cta.type === 'data_gap' && cta.action === 'open_nutrition' && liveNutrition?.logged) {
      return false;
    }
    return true;
  });

  return (
    <DashboardCard className="dashboard-card--coach">
      {coach.briefing && (
        <div className="coach-briefing">
          <Text size="md" lh={1.5}>{coach.briefing}</Text>
        </div>
      )}

      {activeCtas.length > 0 && (
        <Stack gap="xs" mt="md">
          {activeCtas.map((cta, i) => (
            <Paper
              key={i}
              className={`coach-cta coach-cta--${cta.type}`}
              p="sm"
              radius="sm"
              onPointerDown={() => onCtaAction?.(cta)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCtaAction?.(cta); }}
              role={cta.action ? 'button' : undefined}
              tabIndex={cta.action ? 0 : undefined}
            >
              <Group gap="xs" wrap="nowrap">
                <Text size="sm">{ctaIcon(cta.type)}</Text>
                <Text size="sm">{cta.message}</Text>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {coach.prompts?.length > 0 && (
        <Stack gap="xs" mt="md">
          {coach.prompts.map((prompt, i) => (
            <div key={i} className="coach-prompt">
              <Text size="sm" fw={500} mb="xs">{prompt.question}</Text>
              {prompt.type === 'multiple_choice' && prompt.options && (
                <Group gap="xs">
                  {prompt.options.map((opt, j) => (
                    <Paper
                      key={j}
                      className="prompt-option"
                      p="xs"
                      radius="sm"
                      role="button"
                      tabIndex={0}
                      onPointerDown={() => {/* Phase 5: interactive coaching */}}
                    >
                      <Text size="sm">{opt}</Text>
                    </Paper>
                  ))}
                </Group>
              )}
            </div>
          ))}
        </Stack>
      )}
    </DashboardCard>
  );
}

function ctaIcon(type) {
  switch (type) {
    case 'data_gap': return '\u26A0';
    case 'observation': return '\uD83D\uDCC8';
    case 'nudge': return '\u27A1';
    default: return '\u2022';
  }
}
