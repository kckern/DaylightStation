import React, { useState, useRef } from 'react';
import { Text, Stack, Badge } from '@mantine/core';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useScreen } from '@/screen-framework/providers/ScreenProvider.jsx';
import { DashboardCard } from '../_shared/DashboardCard.jsx';
import './FitnessSessionsWidget.scss';

/**
 * Build display URL from a media ID that may or may not be namespaced.
 */
function mediaDisplayUrl(contentId) {
  if (!contentId) return null;
  const str = String(contentId);
  if (str.includes(':')) {
    const [source, id] = str.split(':', 2);
    return `/api/v1/display/${source}/${id}`;
  }
  return `/api/v1/display/plex/${str}`;
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

// ─── Sessions Card ─────────────────────────────────────────

function SessionsCard({ sessions, onSessionClick, selectedSessionId }) {
  if (!sessions || sessions.length === 0) {
    return (
      <DashboardCard title="Recent Sessions" className="dashboard-card--workouts">
        <Text c="dimmed" ta="center" py="md">No recent sessions</Text>
      </DashboardCard>
    );
  }

  const groups = [];
  let currentDate = null;
  for (const s of sessions) {
    if (s.date !== currentDate) {
      currentDate = s.date;
      groups.push({ date: s.date, label: formatDate(s.date), sessions: [] });
    }
    groups[groups.length - 1].sessions.push(s);
  }
  for (const g of groups) g.sessions.reverse();

  return (
    <DashboardCard title="Recent Sessions" className="dashboard-card--workouts">
      <Stack gap={4}>
        {groups.map((group) => (
          <div key={group.date}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" className="session-date-header">
              {group.label}
            </Text>
            {group.sessions.map((s) => {
              const pm = s.media?.primary;
              const bgUrl = pm?.grandparentId
                ? mediaDisplayUrl(pm.contentId || pm.mediaId)
                : null;
              return (
                <div
                  key={s.sessionId}
                  className={`session-row${bgUrl ? ' session-row--has-bg' : ''}${s.sessionId === selectedSessionId ? ' session-row--selected' : ''}`}
                  style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
                  onPointerDown={() => onSessionClick?.(s.sessionId)}
                >
                  <div className="session-row__top">
                    {pm?.grandparentId ? (
                      <img
                        src={mediaDisplayUrl(pm.grandparentId)}
                        alt=""
                        className="session-poster"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : pm ? (
                      <img
                        src={mediaDisplayUrl(pm.contentId || pm.mediaId)}
                        alt=""
                        className="session-poster"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="session-poster session-poster--placeholder" />
                    )}

                    <div className="session-row__info">
                      <div className="session-row__title-line">
                        <Text size="md" fw={700} truncate="end" title={pm?.title || 'Workout'}>
                          {pm?.title || (s.participants && Object.values(s.participants).map(p => p.displayName).join(', ')) || 'Workout'}
                        </Text>
                        {pm?.showTitle && (
                          <Text size="xs" c="dimmed" truncate="end" title={pm.showTitle}>
                            {pm.showTitle}
                          </Text>
                        )}
                      </div>

                      <div className="session-row__meta">
                        <Text size="xs" c="dimmed" fw={500}>
                          {s.startTime ? new Date(s.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(s.timezone ? { timeZone: s.timezone } : {}) }).toLowerCase().replace(' ', '') : '--'}
                        </Text>
                        <span className="session-row__sep" />
                        {s.durationMs > 0 && (
                          <Badge variant="filled" color="dark" size="xs" radius="sm">
                            {Math.round(s.durationMs / 60000)}m
                          </Badge>
                        )}
                        {s.totalCoins > 0 && (
                          <Badge variant="transparent" size="xs" color="yellow" p={0}>
                            +{s.totalCoins}
                          </Badge>
                        )}
                      </div>

                      {s.participants && Object.keys(s.participants).length > 0 && (
                        <div className="session-row__participants">
                          {Object.entries(s.participants).map(([id, p]) => (
                            <span key={id} className="session-row__participant">
                              <img
                                src={`/api/v1/static/users/${id}`}
                                alt={p.displayName}
                                title={p.displayName}
                                className="session-avatar"
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {s.voiceMemos?.length > 0 && (
                    <div className="session-row__memos">
                      <Text size="xs" c="dimmed" className="session-row__memo-text">
                        {s.voiceMemos.map(m => m.transcript).join(' ')}
                      </Text>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </Stack>
    </DashboardCard>
  );
}

// ─── Widget (screen-framework connector) ──────────────────

export default function FitnessSessionsWidget() {
  const rawSessions = useScreenData('sessions');
  const { replace } = useScreen();
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const revertRef = useRef(null);

  const sessions = rawSessions?.sessions || [];

  const handleSessionClick = (sessionId) => {
    if (selectedSessionId === sessionId) {
      revertRef.current?.revert();
      revertRef.current = null;
      setSelectedSessionId(null);
      return;
    }
    revertRef.current?.revert();
    setSelectedSessionId(sessionId);
    revertRef.current = replace('right-area', {
      children: [{ widget: 'fitness:session-detail', props: { sessionId } }]
    });
  };

  return (
    <SessionsCard
      sessions={sessions}
      onSessionClick={handleSessionClick}
      selectedSessionId={selectedSessionId}
    />
  );
}
