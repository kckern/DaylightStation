/** School reading lifecycle and installed learner action assembly. */
export async function createSchoolReadingRuntime({ schoolLifecycle, rootLogger, configService, eventBus, NodeAsyncScheduler, nfcLocationsForReachability, homeAutomationAdapters, server, wakeScreenForBroadcast, resolveLearnerProfile, v1Routers }) {
  let readingSessions = null;
  let readingSessionInterceptor = null;
  if (schoolLifecycle.wired && schoolLifecycle.storyTimeLauncher) {
    const readingLogger = rootLogger.child({ module: 'school-reading' });
    const { ReadingSessionService } = await import("../application/ReadingSessionService.mjs");
    const { ReadingApiService } = await import("../application/ReadingApiService.mjs");
    const { ReadingSessionInterceptor } = await import("../application/readingSessionInterceptor.mjs");
    const { RecordStoryRead } = await import("../application/usecases/RecordStoryRead.mjs");
    const { createReadingRouter } = await import("../api/reading.mjs");

    const { makeReadingTimeoutHandler } = await import("./learnerCardActions.mjs");
    const { YamlReadingSessionTimelineStore } = await import("../adapters/persistence/YamlReadingSessionTimelineStore.mjs");
    const { YamlReadingSessionStore } = await import("../adapters/persistence/YamlReadingSessionStore.mjs");
    const { EventBusSchoolRealtimeAdapter } = await import("../adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs");
    const readingTimeline = new YamlReadingSessionTimelineStore({ configService, logger: readingLogger });
    // The open sessions themselves, so a deploy does not erase the living room.
    // See IReadingSessionStore: a redeploy four minutes into a 9m40s read-along
    // left a child finishing his book into a server that had forgotten him.
    const readingSessionStore = new YamlReadingSessionStore({ configService, logger: readingLogger });
    // One gateway for the whole reading ceremony. Passing the raw event bus
    // here stopped working when the application layer moved to the School
    // realtime port: JavaScript ignored the unknown `eventBus` option, leaving
    // activation and book-selection broadcasts as silent no-ops.
    const readingRealtime = new EventBusSchoolRealtimeAdapter({ eventBus });

    readingSessions = new ReadingSessionService({
      realtime: readingRealtime,
      logger: readingLogger,
      // Delivery recovery and idle teardown are both scheduler-owned. Without
      // this adapter an ACK wait never reaches its deadline, so the first lost
      // cold-wake broadcast strands the intent forever instead of replaying it.
      scheduler: new NodeAsyncScheduler(),
      observationStore: readingTimeline,
      sessionStore: readingSessionStore,
      // D6 — the session owns teardown, and this is it. The location's own
      // `end: tv-off` is suppressed while a session is open (D8), so nothing
      // else will ever turn this TV off: an abandoned prompt would leave the
      // living room lit all night and the next card tap would land in a
      // session belonging to a child who left.
      onTimeout: makeReadingTimeoutHandler({
        locations: nfcLocationsForReachability, tv: homeAutomationAdapters.tvAdapter, logger: readingLogger,
      }),
    });
    // Sessions come BACK before the first request is served: a card tapped
    // during boot must not open a second session for a room that already has
    // one.
    await readingSessions.hydrate();
    readingSessions.start();
    server?.once?.('close', () => readingSessions.stop());

    readingSessionInterceptor = new ReadingSessionInterceptor({
      sessions: readingSessions,
      storyTime: schoolLifecycle.storyTimeLauncher,
      realtime: readingRealtime,
      // ONLY the reopen path uses this, and it is the same seam the
      // learner-card handler wakes with — one room, one way to wake a screen a
      // mounted widget is about to be told something on. A reopened session is
      // the one claim that can be racing this reader's own `end: tv-off`
      // teardown, and a claimed book never reaches `wake-and-load`, so without
      // it the launch card comes back on a TV the sweep just powered off.
      wakeScreen: wakeScreenForBroadcast,
      logger: readingLogger,
    });

    const readingService = new ReadingApiService({
      recordStoryRead: new RecordStoryRead({
        readingLog: schoolLifecycle.stores.readingLog,
        // A FUNCTION, not a timezone, and deliberately so: this is the ONE
        // place the household's 4am study-day boundary is applied, and a
        // second independently-configured source of the shard key would drift
        // from the launcher's own "how many today" without erroring.
        studyDay: () => schoolLifecycle.storyTimeLauncher.studyDay(),
        realtime: readingRealtime,
        logger: readingLogger,
      }),
      sessions: readingSessions,
      storyTime: schoolLifecycle.storyTimeLauncher,
      readingLog: schoolLifecycle.stores.readingLog,
      // Optional: without it the prompt falls back to the learner id, which is
      // a worse greeting and not a broken one.
      resolveLearner: resolveLearnerProfile,
      // Days the whole house is off, in the same shape a syllabus schedule
      // takes. Only the household declares Christmas — a course's own `except`
      // excuses a subject, which is a different statement and a different
      // square on the wall.
      // Validated once, by the lifecycle, off the same block the agenda and
      // the term grid plan against — not a second, independent read of the raw
      // config that could reach a different verdict about the same day.
      householdCalendar: schoolLifecycle.householdSchedule ?? null,
      logger: readingLogger,
      observationStore: readingTimeline,
    });
    v1Routers.school.use('/reading', createReadingRouter({ readingService }));
  } else {
    rootLogger.warn('school.reading.unwired', {
      reason: schoolLifecycle.wired ? 'no story-time launcher' : 'school lifecycle not wired',
    });
  }

  return { readingSessions, readingSessionInterceptor };
}

export async function registerSchoolReadingAction({ readingSessions, deviceServices, homeAutomationAdapters, learnerDisplayName, screenContentTracker, wakeScreenForBroadcast, schoolLifecycle, eventBus, rootLogger, learnerActions, nfcLocationsForReachability }) {
  let startReadingSession = null;
if (readingSessions) {
    const { makeReadingSessionHandler } = await import("./learnerCardActions.mjs");
    const { NotifyReadingSessionFailure } = await import("../application/workflows/NotifyReadingSessionFailure.mjs");
    const notifyReadingSessionFailure = new NotifyReadingSessionFailure({
      notificationTargetForDevice: (id) => deviceServices.deviceService.get(id)?.notifyService ?? null,
      notifier: homeAutomationAdapters.haGateway?.callService ? homeAutomationAdapters.haGateway : null,
      studentName: learnerDisplayName,
      deviceLabel: (id) => deviceServices.deviceService.get(id)?.name ?? null,
    });
    const readingSessionHandler = makeReadingSessionHandler({
      sessions: readingSessions,
      // D2 — the one question that can refuse a tap: is unrelated content
      // already up on this reader's TV? The SAME tracker the presence
      // publisher feeds, so "is something playing" has one answer in the house.
      isPlaying: (target) => (target ? screenContentTracker.isPlaying(target) === true : false),
      // Power on and bring the kiosk forward. NOT a content load and NOT a
      // `clearContent()`: the reading widget is already mounted on that
      // screen, and reloading the page would drop the very WebSocket that
      // carried the `session-open` this tap just produced. Now shared with
      // the media-lesson dispatch, which needs it for the same reason — see
      // `wakeScreenForBroadcast` above.
      wakeScreen: wakeScreenForBroadcast,
      // An ADOPTED story is a pick minted at card time, so it needs the same
      // study day the interceptor stamps on a book-time pick — from the same
      // launcher, so the two can never disagree about which day a read counts.
      studyDay: () => schoolLifecycle.storyTimeLauncher?.studyDay?.() ?? null,
      // The one story-time failure push. With no HA gateway `notifier` is
      // null and the use case sends nothing, as the inline copy it replaced did.
      alertAdult: (args) => notifyReadingSessionFailure.execute(args),
      eventBus,
      logger: rootLogger.child({ module: 'trigger-learner' }),
    });
    learnerActions.register('reading-session', readingSessionHandler);
    startReadingSession = ({ learnerId, origin = 'portal' } = {}) => {
      const locations = Object.entries(nfcLocationsForReachability() || {})
        .filter(([, cfg]) => cfg?.learner_action === 'reading-session');
      if (locations.length !== 1) {
        return { status: 'reading_session_failed', message: 'Story time needs one configured reading room.' };
      }
      const [location, cfg] = locations[0];
      return readingSessionHandler({ learnerId, location, target: cfg?.target ?? cfg?.device ?? null, origin });
    };
  }
  return { startReadingSession };
}
