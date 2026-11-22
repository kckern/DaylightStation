import { useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { getOfflineEdition, removeOfflineEdition, saveOfflineEdition } from "./feedOfflineStore.js";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";

const log = getLogger().child({ app: 'feed', module: 'offline-edition' });

export default function OfflineEditionButton({ item, detail = null, onRemoved }) {
  const [edition, setEdition] = useState({ itemId: null, status: 'loading', downloaded: false });
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const isCurrent = edition.itemId === item.id;
  const checking = !isCurrent || edition.status === 'loading';
  const lookupFailed = isCurrent && edition.status === 'error';
  const downloaded = isCurrent && edition.status === 'ready' && edition.downloaded;

  useEffect(() => {
    let active = true;
    setEdition({ itemId: item.id, status: 'loading', downloaded: false });
    getOfflineEdition(item.id)
      .then(value => { if (active) setEdition({ itemId: item.id, status: 'ready', downloaded: !!value }); })
      .catch(() => { if (active) setEdition({ itemId: item.id, status: 'error', downloaded: false }); });
    return () => { active = false; };
  }, [item.id, lookupAttempt]);

  const toggle = async () => {
    if (busy || checking) return;
    if (lookupFailed) {
      setEdition({ itemId: item.id, status: 'loading', downloaded: false });
      setLookupAttempt(attempt => attempt + 1);
      return;
    }
    setBusy(true);
    try {
      if (downloaded) {
        await removeOfflineEdition(item.id);
        setEdition(current => current.itemId === item.id
          ? { itemId: item.id, status: 'ready', downloaded: false }
          : current);
        onRemoved?.(item.id);
        notifications.show({ title: 'Download removed', message: 'The article remains available while online.' });
      } else {
        await saveOfflineEdition(item, detail);
        setEdition(current => current.itemId === item.id
          ? { itemId: item.id, status: 'ready', downloaded: true }
          : current);
        notifications.show({ title: 'Available offline', message: 'The article and its current readable content were downloaded to this device.' });
      }
    } catch (error) {
      log.warn('feed.offline_edition.failed', { itemId: item.id, error: error.message });
      notifications.show({
        color: 'red',
        title: downloaded ? 'Offline removal failed' : 'Offline download failed',
        message: downloaded ? "Couldn't remove the offline copy." : 'This browser could not store the article.',
      });
    } finally {
      setBusy(false);
    }
  };

  return <button type="button" aria-pressed={downloaded} aria-busy={busy || checking} disabled={busy || checking} onClick={toggle}>
    {busy ? 'Working…' : checking ? 'Checking…' : lookupFailed ? 'Retry check' : downloaded ? 'Downloaded' : 'Download'}
  </button>;
}
