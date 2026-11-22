import { ThemeIcon } from '@mantine/core';
import {
  IconRun, IconCalendar, IconScale, IconBrandGithub,
  IconMail, IconMusic, IconBrandReddit, IconShoppingCart,
  IconChecklist, IconNotebook, IconApple, IconMapPin,
} from '@tabler/icons-react';
import { humanize } from '../../../lib/format.js';

const SOURCE_MAP = {
  strava: { label: 'Strava', icon: IconRun, color: 'orange' },
  fitness: { label: 'Fitness', icon: IconRun, color: 'orange' },
  calendar: { label: 'Calendar', icon: IconCalendar, color: 'blue' },
  weight: { label: 'Weight', icon: IconScale, color: 'green' },
  github: { label: 'GitHub', icon: IconBrandGithub, color: 'dark' },
  gmail: { label: 'Gmail', icon: IconMail, color: 'red' },
  lastfm: { label: 'Last.fm', icon: IconMusic, color: 'grape' },
  reddit: { label: 'Reddit', icon: IconBrandReddit, color: 'orange' },
  shopping: { label: 'Shopping', icon: IconShoppingCart, color: 'teal' },
  todoist: { label: 'Todoist', icon: IconChecklist, color: 'red' },
  clickup: { label: 'ClickUp', icon: IconChecklist, color: 'violet' },
  journalist: { label: 'Journalist', icon: IconNotebook, color: 'yellow' },
  nutrition: { label: 'Nutrition', icon: IconApple, color: 'lime' },
  checkins: { label: 'Check-ins', icon: IconMapPin, color: 'cyan' },
};

export function sourceLabel(source) {
  return SOURCE_MAP[source]?.label ?? humanize(source);
}

export function SourceIcon({ source, size = 'md', decorative = false }) {
  const config = SOURCE_MAP[source] || { icon: IconChecklist, color: 'gray' };
  const Icon = config.icon;

  return (
    <ThemeIcon color={config.color} variant="light" size={size} aria-hidden={decorative || undefined}>
      <Icon size={16} />
    </ThemeIcon>
  );
}
