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

// ─── Nutrition Card ────────────────────────────────────────────

export function NutritionCard({ nutrition, goals }) {
  if (!nutrition || !nutrition.logged) {
    return (
      <DashboardCard title="Nutrition" className="dashboard-card--nutrition">
        <Text c="dimmed" ta="center" py="md">No meals logged today</Text>
      </DashboardCard>
    );
  }

  const calTarget = goals?.nutrition?.daily_calories || 2200;
  const calRatio = nutrition.calories / calTarget;
  const calPercent = Math.min(100, Math.round(calRatio * 100));

  return (
    <DashboardCard title="Nutrition" className="dashboard-card--nutrition">
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={3} className="dashboard-stat-value">{nutrition.calories}</Title>
          <Text size="sm" c="dimmed">/ {calTarget} cal</Text>
        </Group>
        <Progress value={calPercent} color={calRatio > 1 ? 'red' : 'blue'} size="sm" />
        <Group justify="space-between" mt="xs">
          <MacroLabel label="Protein" value={nutrition.protein} unit="g" />
          <MacroLabel label="Carbs" value={nutrition.carbs} unit="g" />
          <MacroLabel label="Fat" value={nutrition.fat} unit="g" />
        </Group>
      </Stack>
    </DashboardCard>
  );
}

function MacroLabel({ label, value, unit }) {
  return (
    <Stack gap={0} align="center">
      <Text size="lg" fw={600}>{Math.round(value)}</Text>
      <Text size="xs" c="dimmed">{label} ({unit})</Text>
    </Stack>
  );
}

// ─── Recent Workouts Card ──────────────────────────────────────

export function WorkoutsCard({ workouts }) {
  if (!workouts || workouts.length === 0) {
    return (
      <DashboardCard title="Recent Workouts" className="dashboard-card--workouts">
        <Text c="dimmed" ta="center" py="md">No recent workouts</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Recent Workouts" className="dashboard-card--workouts">
      <Stack gap="xs">
        {workouts.slice(0, 4).map((w, i) => (
          <Group key={i} justify="space-between" className="workout-row">
            <div>
              <Text size="sm" fw={500}>{w.title}</Text>
              <Text size="xs" c="dimmed">{formatDate(w.date)}</Text>
            </div>
            <Group gap="xs">
              {w.duration && <Badge variant="light" size="sm">{w.duration} min</Badge>}
              {w.calories && <Badge variant="light" color="orange" size="sm">{w.calories} cal</Badge>}
            </Group>
          </Group>
        ))}
      </Stack>
    </DashboardCard>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  const diff = Math.floor((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
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
