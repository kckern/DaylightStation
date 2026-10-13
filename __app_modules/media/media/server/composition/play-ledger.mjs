export async function createMediaPlayLedger({configService,householdId,rootLogger}) {
  // Per-screen play ledger — one row per playback start per screen, fed by
  // play/log (RecordPlaybackProgress) and read by the household media memory.
  // Day files under history/media-plays, 90-day retention.
  // See __docs/reference/media/media-app-technical.md §2.4.
  let playLedger = null;
  // Who asked for a load (a routine, another screen) → the screen's next
  // ledger start. Written by the device router's load recorder (mediaHouse).
  const { LoadOriginHints } = await import('../application/LoadOriginHints.mjs');
  const loadOriginHints = new LoadOriginHints();
  {
    const { PlayLedgerRecorder } = await import('../application/PlayLedgerRecorder.mjs');
    const { YamlPlayLedgerDatastore } = await import('../adapters/persistence/YamlPlayLedgerDatastore.mjs');
    const { PLAY_LEDGER_RETENTION_DAYS } = await import('../domain/playLedger.mjs');
    const { nowTs24 } = await import('#system/utils/index.mjs');
    const playLedgerLogger = rootLogger.child({ module: 'play-ledger' });
    playLedger = new PlayLedgerRecorder({
      store: new YamlPlayLedgerDatastore({
        root: configService.getHouseholdPath('history/media-plays', householdId),
        retentionDays: PLAY_LEDGER_RETENTION_DAYS,
        today: () => nowTs24().slice(0, 10),
        logger: playLedgerLogger,
      }),
      originHints: loadOriginHints,
      logger: playLedgerLogger,
    });
  }

  return {playLedger,loadOriginHints};
}
