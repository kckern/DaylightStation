import { createNfcTapIngress as createApplicationNfcTapIngress } from '#apps/scan/NfcTapIngress.mjs';
import { EventBusEventInputSource } from '#adapters/scan/EventBusEventInputSource.mjs';

/** Compatibility composition factory binding the event bus and legacy shutdown config. */
export function createNfcTapIngress({
  eventBus, topics = ['omr'], getShutdownConfig = null, ...dependencies
} = {}) {
  return createApplicationNfcTapIngress({
    ...dependencies,
    tapSource: eventBus ? new EventBusEventInputSource({ eventBus, topics }) : null,
    getShutdownCommand: getShutdownConfig ? () => {
      const nfc = getShutdownConfig()?.nfc;
      return nfc ? { tagUid: nfc.tagUid ?? nfc.tag_uid ?? nfc.uid, readerId: nfc.readerId ?? nfc.reader_id } : null;
    } : null,
  });
}

export default createNfcTapIngress;
