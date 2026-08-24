import { useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { getOfflineEdition, removeOfflineEdition, saveOfflineEdition } from './feedOfflineStore.js';
import getLogger from '../../../lib/logging/Logger.js';

const log = getLogger().child({ app: 'feed', module: 'offline-edition' });

export default function OfflineEditionButton({ item, detail = null }) {
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getOfflineEdition(item.id).then(value => { if (active) setDownloaded(!!value); }).catch(() => {});
    return () => { active = false; };
  }, [item.id]);

  const toggle = async () => {
    setBusy(true);
    try {
      if (downloaded) {
        await removeOfflineEdition(item.id);
        setDownloaded(false);
        notifications.show({ title: 'Download removed', message: 'The article remains available while online.' });
      } else {
        await saveOfflineEdition(item, detail);
        setDownloaded(true);
        notifications.show({ title: 'Available offline', message: 'The article and its current readable content were downloaded to this device.' });
      }
    } catch (error) {
      log.warn('feed.offline_edition.failed', { itemId: item.id, error: error.message });
      notifications.show({ color: 'red', title: 'Offline download failed', message: 'This browser could not store the article.' });
    } finally {
      setBusy(false);
    }
  };

  return <button type="button" aria-pressed={downloaded} disabled={busy} onClick={toggle}>{busy ? 'Working…' : downloaded ? 'Downloaded' : 'Download'}</button>;
}
