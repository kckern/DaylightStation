import React from 'react';
import { useScreenData } from '../../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '../../../../FitnessScreenProvider.jsx';
import { UpNextCard } from '../DashboardWidgets.jsx';
import { parseContentId } from '../useDashboardData.js';

export default function FitnessUpNextWidget() {
  const dashboard = useScreenData('dashboard');
  const { onPlay } = useFitnessScreen();

  if (!dashboard?.dashboard?.curated) return null;

  const handlePlay = (contentItem) => {
    if (!contentItem?.content_id || !onPlay) return;
    const { source, localId } = parseContentId(contentItem.content_id);
    onPlay({
      id: localId,
      contentSource: source,
      type: 'episode',
      title: contentItem.title,
      videoUrl: `/api/v1/play/${source}/${localId}`,
      image: `/api/v1/display/${source}/${localId}`,
      duration: contentItem.duration,
    });
  };

  return <UpNextCard curated={dashboard.dashboard.curated} onPlay={handlePlay} />;
}
