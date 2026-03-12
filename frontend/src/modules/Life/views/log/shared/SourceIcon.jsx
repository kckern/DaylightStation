import { ThemeIcon } from '@mantine/core';
import {
  IconRun, IconCalendar, IconScale, IconBrandGithub,
  IconMail, IconMusic, IconBrandReddit, IconShoppingCart,
  IconChecklist, IconNotebook, IconApple, IconMapPin,
} from '@tabler/icons-react';

const SOURCE_MAP = {
  strava: { icon: IconRun, color: 'orange' },
  fitness: { icon: IconRun, color: 'orange' },
  calendar: { icon: IconCalendar, color: 'blue' },
  weight: { icon: IconScale, color: 'green' },
  github: { icon: IconBrandGithub, color: 'dark' },
  gmail: { icon: IconMail, color: 'red' },
  lastfm: { icon: IconMusic, color: 'grape' },
  reddit: { icon: IconBrandReddit, color: 'orange' },
  shopping: { icon: IconShoppingCart, color: 'teal' },
  todoist: { icon: IconChecklist, color: 'red' },
  clickup: { icon: IconChecklist, color: 'violet' },
  journalist: { icon: IconNotebook, color: 'yellow' },
  nutrition: { icon: IconApple, color: 'lime' },
  checkins: { icon: IconMapPin, color: 'cyan' },
};

export function SourceIcon({ source, size = 'md' }) {
  const config = SOURCE_MAP[source] || { icon: IconChecklist, color: 'gray' };
  const Icon = config.icon;

  return (
    <ThemeIcon color={config.color} variant="light" size={size}>
      <Icon size={16} />
    </ThemeIcon>
  );
}
