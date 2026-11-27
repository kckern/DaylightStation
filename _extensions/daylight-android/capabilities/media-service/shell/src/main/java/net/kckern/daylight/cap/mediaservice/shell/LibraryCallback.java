package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.DrivingRadioSettings;
import net.kckern.daylight.shellkit.PackageFacts;

import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import android.util.Log;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.CommandButton;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;
import androidx.media3.session.MediaLibraryService.LibraryParams;
import androidx.media3.session.MediaLibraryService.MediaLibrarySession;
import androidx.media3.session.MediaSession;

import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.SettableFuture;

import net.kckern.daylight.api.PayloadPort;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Every browse and play question goes to the payload. This class holds no media
 * knowledge: it turns Media3 callbacks into port calls and the answers into items.
 *
 * Nothing here runs a request on the caller's thread (the main thread): each
 * question is put on the io executor and answered through a future.
 *
 * Fallback when no payload is loaded (a car bound the service in a cold process):
 * the root answers one entry, "Daylight is starting", and the car is told to ask
 * again once a payload attaches. A play request then fails; nothing crashes.
 */
final class LibraryCallback implements MediaLibrarySession.Callback {
    private static final String TAG = "Daylight-Media";
    /** How long a browse waits for a payload after a cold start. Short: a car gives up on a slow answer. */
    private static final long BROWSE_WAIT_MS = 4000;
    private static final long PLAY_WAIT_MS = 8000;
    /**
     * A request extra this app's own screens set (NowPlayingActivity.playRequest): the order
     * is theirs to choose. True asks home for the list shuffled; either way the player's own
     * shuffle mode goes off in the same step as the new queue, so the queue that was there is
     * never shuffled or unshuffled in front of the person first.
     */
    static final String EXTRA_SHUFFLE = "daylight.shuffle";
    /** The track-alone question of a first tap (FirstTap), apart from the list's. */
    private final ExecutorService firstIo = java.util.concurrent.Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "Daylight-media-first");
        t.setDaemon(true);
        return t;
    });
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    /** How long the service keeps waiting to tell a car that the real tree is there. */
    private static final long STARTING_WAIT_MS = 120_000;

    private final PayloadMedia media;
    private final ExecutorService io;
    private final String myPackage;
    private final PackageFacts facts;
    /** The pinned controllers as the payload last cached them; read at each connection. */
    private final java.util.function.Supplier<String> pinCache;
    private final Runnable stopPlayback;
    /** The sleep timer: set by its own session command, held here for the session's life. */
    final SleepTimer sleep = new SleepTimer();
    private DrivingRadio radio;
    private Runnable cancelHandoff = () -> {};
    private final AtomicBoolean waitingForPayload = new AtomicBoolean();

    LibraryCallback(PayloadMedia media, ExecutorService io, String myPackage, PackageFacts facts,
                    java.util.function.Supplier<String> pinCache, Runnable stopPlayback) {
        this.media = media;
        this.io = io;
        this.myPackage = myPackage;
        this.facts = facts;
        this.pinCache = pinCache;
        this.stopPlayback = stopPlayback;
    }

    LibraryCallback withDrivingRadio(DrivingRadio drivingRadio, Runnable cancel) {
        radio = drivingRadio;
        cancelHandoff = cancel;
        return this;
    }

    @Override
    public int onPlayerCommandRequest(MediaSession session, MediaSession.ControllerInfo controller, int command) {
        if (command == androidx.media3.common.Player.COMMAND_PLAY_PAUSE
                || command == androidx.media3.common.Player.COMMAND_STOP
                || command == androidx.media3.common.Player.COMMAND_CHANGE_MEDIA_ITEMS) cancelHandoff.run();
        return MediaLibrarySession.Callback.super.onPlayerCommandRequest(session, controller, command);
    }

    @Override
    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onPlaybackResumption(
            MediaSession session, MediaSession.ControllerInfo controller) {
        Log.i(TAG, "playback resumption asked by " + controller.getPackageName());
        MediaItem request;
        if (radio != null && DrivingRadio.isCar(controller) && radio.enabled()) {
            request = new MediaItem.Builder().setMediaId(DrivingRadioSettings.MEDIA_ID).build();
        } else {
            // A media button or the system's resume card, with nothing queued: pick up the
            // last thing played. The id is resolved by the payload like any other.
            MediaItem last = radio == null ? null : radio.last();
            if (last == null) {
                Log.i(TAG, "playback resumption: nothing played yet");
                return MediaLibrarySession.Callback.super.onPlaybackResumption(session, controller);
            }
            Log.i(TAG, "playback resumption: resuming the last item played");
            request = new MediaItem.Builder().setMediaId(last.mediaId).build();
        }
        return onSetMediaItems(session, controller, Collections.singletonList(request), C.INDEX_UNSET, C.TIME_UNSET);
    }

    @Override
    public MediaSession.ConnectionResult onConnect(MediaSession session, MediaSession.ControllerInfo controller) {
        // The name is what the caller says; the uid is Binder's. See ControllerPolicy.
        ControllerPolicy.Decision decision = ControllerPolicy.decide(controller.getPackageName(), controller.getUid(),
                Process.myUid(), myPackage, Build.VERSION.SDK_INT, facts, ControllerPins.fromCache(pinCache.get()));
        if (!decision.allowed) {
            // The line names the package and, when it is the caller's own, its certificate
            // digest: what the owner adds to media.controllerPins to allow a car.
            Log.w(TAG, decision.logLine(String.valueOf(controller.getPackageName())));
            return MediaSession.ConnectionResult.reject();
        }
        return new MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(sessionCommands())
                .build();
    }

    private static SessionCommands sessionCommands() {
        SessionCommands.Builder commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon();
        for (String action : CarControls.ACTIONS) commands.add(new SessionCommand(action, Bundle.EMPTY));
        commands.add(new SessionCommand(SleepTimer.ACTION, Bundle.EMPTY));
        return commands.build();
    }

    @Override
    public ListenableFuture<SessionResult> onCustomCommand(MediaSession session, MediaSession.ControllerInfo controller,
                                                            SessionCommand command, Bundle arguments) {
        if (SleepTimer.ACTION.equals(command.customAction)) {
            sleep.set(session, arguments.getInt(SleepTimer.ARG_MINUTES, 0), arguments.getLong(SleepTimer.ARG_AT_MS, -1));
            return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
        }
        if (!CarControls.run(command.customAction, session.getPlayer(), stopPlayback))
            return MediaLibrarySession.Callback.super.onCustomCommand(session, controller, command, arguments);
        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
    }

    @Override
    public void onDisconnected(MediaSession session, MediaSession.ControllerInfo controller) {
        if (DrivingRadio.isCar(controller)) cancelHandoff.run();
    }

    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetItem(
            MediaLibrarySession session, MediaSession.ControllerInfo browser, String mediaId) {
        if (radio != null && DrivingRadio.isCar(browser) && radio.enabled()
                && DrivingRadioSettings.MEDIA_ID.equals(mediaId)) {
            return Futures.immediateFuture(LibraryResult.ofItem(NodeItems.drivingRadio(radio.todayTitle()), null));
        }
        return MediaLibrarySession.Callback.super.onGetItem(session, browser, mediaId);
    }

    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(
            MediaLibrarySession session, MediaSession.ControllerInfo browser, LibraryParams params) {
        // The root is fixed, so a car gets an answer before the payload is up. The extras tell
        // Android Auto that this app's items carry content-style hints (the Drive grid); a
        // "recent" root is the system asking what it could resume.
        Bundle extras = new Bundle();
        extras.putBoolean(NodeItems.STYLE_SUPPORTED, true);
        LibraryParams.Builder reply = new LibraryParams.Builder().setExtras(extras);
        if (params != null && params.isRecent) reply.setRecent(true);
        return Futures.immediateFuture(LibraryResult.ofItem(NodeItems.root(), reply.build()));
    }

    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(
            final MediaLibrarySession session, MediaSession.ControllerInfo browser, final String parentId,
            final int page, final int pageSize, final LibraryParams params) {
        if (params != null && params.isRecent && NodeItems.ROOT.equals(parentId)) {
            // What the system may offer to resume: the one item last played, or nothing.
            MediaItem last = radio == null ? null : radio.last();
            return Futures.immediateFuture(LibraryResult.ofItemList(
                    last == null || page > 0 ? ImmutableList.<MediaItem>of() : ImmutableList.of(last), params));
        }
        final SettableFuture<LibraryResult<ImmutableList<MediaItem>>> future = SettableFuture.create();
        try {
            io.execute(() -> {
                try {
                    if (radio != null && DrivingRadio.DRIVE.equals(parentId)) {
                        List<MediaItem> drive = page == 0 ? radio.staples() : Collections.emptyList();
                        if (page == 0 && radio.enabled()) drive.add(0, NodeItems.drivingRadio(radio.todayTitle(), radio.todayArt()));
                        future.set(LibraryResult.ofItemList(drive, params));
                        // Tiles with no picture are fetched now; each one saved tells the car to ask again.
                        radio.fillMissingArt();
                        return;
                    }
                    List<BrowseAnswer.Entry> entries;
                    if (BrowseAnswer.STARTING_ID.equals(parentId)) {
                        entries = Collections.emptyList();
                    } else {
                        try {
                            entries = BrowseAnswer.parse(media.browse(parentId, page, pageSize, BROWSE_WAIT_MS));
                        } catch (PayloadPort.NotReadyException noPayload) {
                            entries = NodeItems.ROOT.equals(parentId) ? BrowseAnswer.starting() : Collections.<BrowseAnswer.Entry>emptyList();
                            tellWhenReady(session);
                        }
                    }
                    List<MediaItem> nodes = NodeItems.nodes(entries);
                    if (!entries.isEmpty()) lastPages.put(parentId + "#" + page, nodes);
                    future.set(LibraryResult.ofItemList(nodes, params));
                } catch (BrowseAnswer.Failed refused) {
                    future.set(lastOr(parentId, page, params, LibraryResult.RESULT_ERROR_IO));
                } catch (Throwable broke) {
                    // The payload is replaceable code; whatever it throws must not take the service down.
                    Log.w(TAG, "browse failed: " + broke.getClass().getSimpleName());
                    future.set(lastOr(parentId, page, params, LibraryResult.RESULT_ERROR_UNKNOWN));
                }
            });
        } catch (RuntimeException stopping) {
            future.set(LibraryResult.<ImmutableList<MediaItem>>ofError(LibraryResult.RESULT_ERROR_INVALID_STATE));
        }
        return future;
    }

    /**
     * The last page each car list answered, so a page home does not answer now shows what it
     * showed before rather than an error (audit: the car's lists failed bare).
     */
    private final java.util.Map<String, List<MediaItem>> lastPages = java.util.Collections.synchronizedMap(
            new java.util.LinkedHashMap<String, List<MediaItem>>(16, 0.75f, true) {
                @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, List<MediaItem>> e) { return size() > 48; }
            });

    private LibraryResult<ImmutableList<MediaItem>> lastOr(String parentId, int page, LibraryParams params, int error) {
        List<MediaItem> last = lastPages.get(parentId + "#" + page);
        return last != null ? LibraryResult.ofItemList(last, params) : LibraryResult.<ImmutableList<MediaItem>>ofError(error);
    }

    /** One waiter at a time: when a payload attaches, browsers of the root are told to ask again. */
    private void tellWhenReady(final MediaLibrarySession session) {
        if (!waitingForPayload.compareAndSet(false, true)) return;
        Thread waiter = new Thread(() -> {
            try {
                if (media.awaitReady(STARTING_WAIT_MS)) {
                    // A session is used from the application's main thread.
                    new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                        try {
                            session.notifyChildrenChanged(NodeItems.ROOT, 1, null);
                        } catch (Throwable released) {
                            // The session was released while waiting.
                        }
                    });
                }
            } finally {
                waitingForPayload.set(false);
            }
        }, "Daylight-media-wait");
        waiter.setDaemon(true);
        waiter.start();
    }

    @Override
    public ListenableFuture<List<MediaItem>> onAddMediaItems(
            MediaSession session, MediaSession.ControllerInfo controller, final List<MediaItem> requested) {
        final SettableFuture<List<MediaItem>> future = SettableFuture.create();
        try {
            io.execute(() -> {
                try { future.set(NodeItems.tracks(resolve(requested, C.INDEX_UNSET, C.TIME_UNSET).tracks)); }
                catch (Throwable e) { future.setException(failure(e)); abandon(requested); }
            });
        } catch (RuntimeException stopping) {
            future.setException(stopping);
            abandon(requested);
        }
        return future;
    }

    @Override
    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(
            MediaSession session, MediaSession.ControllerInfo controller, final List<MediaItem> requested,
            int startIndex, long startPositionMs) {
        cancelHandoff.run();
        final SettableFuture<MediaSession.MediaItemsWithStartPosition> future = SettableFuture.create();
        final Boolean order = orderAsked(requested);
        final boolean shuffle = Boolean.TRUE.equals(order);
        List<String> ids = new ArrayList<>(), queries = new ArrayList<>();
        for (MediaItem item : requested) {
            ids.add(item.mediaId);
            queries.add(item.requestMetadata == null ? null : item.requestMetadata.searchQuery);
        }
        // The phone's mini player too (Now playing is not over a car's tap to say so).
        if (controller != null && DrivingRadio.isCar(controller) && requested.size() == 1) {
            // On the main thread already: the note is in before the new item's first report.
            NowPlayingNotes.starting(requested.get(0).mediaId, NowPlayingNotes.face(requested.get(0)));
        }
        // The car's now-playing card shows the tapped item at once, not the previous one.
        if (requested.size() == 1 && requested.get(0).mediaMetadata.title != null) {
            main.post(() -> {
                androidx.media3.common.Player p = session.getPlayer();
                if (p instanceof QueuePlayer) ((QueuePlayer) p).showStarting(requested.get(0));
            });
        }
        if (!shuffle && FirstTap.races(ids, queries, startPositionMs)) {
            race(session, ids.get(0), order != null, requested, future);
            return future;
        }
        try {
            io.execute(() -> {
                try {
                    TrackAnswer r = resolve(requested, startIndex, startPositionMs, shuffle);
                    long defaultPosition = r.startPositionMs > 0 ? r.startPositionMs : C.TIME_UNSET;
                    long position = r.selectionResolved && startPositionMs >= 0 ? startPositionMs : defaultPosition;
                    // The start item carries the source's name to the queue (QueueTag).
                    answer(session, future, new MediaSession.MediaItemsWithStartPosition(
                            QueueTag.tag(NodeItems.tracks(r.tracks), r.startIndex, requested, shuffle), r.startIndex, position),
                            order != null);
                } catch (Throwable e) {
                    refused(session, future, e, requested);
                }
            });
        } catch (RuntimeException stopping) {
            future.setException(stopping);
            abandon(requested);
        }
        return future;
    }

    /** Whether one of this app's screens chose the order (EXTRA_SHUFFLE), and which; null when not. */
    private static Boolean orderAsked(List<MediaItem> requested) {
        if (requested == null || requested.size() != 1) return null;
        MediaItem.RequestMetadata m = requested.get(0).requestMetadata;
        Bundle extras = m == null ? null : m.extras;
        return extras == null || !extras.containsKey(EXTRA_SHUFFLE) ? null : extras.getBoolean(EXTRA_SHUFFLE);
    }

    /** Hands the queue over; when the order was chosen, the player's shuffle goes off in the same step. */
    private void answer(MediaSession session, SettableFuture<MediaSession.MediaItemsWithStartPosition> future,
                        MediaSession.MediaItemsWithStartPosition items, boolean ownOrder) {
        // Now playing showing this tap as starting: what the player holds once it has taken the
        // items is the answer (Starting.reloadedSinceAnswer). Stamped after they are handed
        // over, on the player's thread, so a controller connecting before then is not "after".
        final String asked = QueueTag.askedOf(items.mediaItems, items.startIndex);
        // With the queue, a new source sets its own shuffle (QueueTag); the old one is left as it was for Undo.
        if (!ownOrder || QueueController.live() != null) {
            future.set(items);
            main.post(() -> noteAnswered(asked));
            return;
        }
        main.post(() -> {
            try { session.getPlayer().setShuffleModeEnabled(false); } catch (RuntimeException released) { /* gone */ }
            future.set(items);
            main.post(() -> noteAnswered(asked));
        });
    }

    /** Main thread. An answer whose request id is unknown (a voice search, an already tagged start) is not noted. */
    private static void noteAnswered(String asked) {
        if (!asked.isEmpty()) Starting.answered(asked, android.os.SystemClock.elapsedRealtime());
    }

    /** A request that failed: the mini player's start for it, if it is still the one showing, gives way (NowPlayingNote.abandonStart). */
    private void abandon(List<MediaItem> requested) {
        final String id = requested == null || requested.isEmpty() ? "" : requested.get(0).mediaId;
        main.post(() -> net.kckern.daylight.shellkit.NowPlayingNote.abandonStart("local", id));
    }

    private void refused(MediaSession session, SettableFuture<?> future, Throwable e, List<MediaItem> requested) {
        future.setException(failure(e));
        main.post(() -> {
            androidx.media3.common.Player p = session.getPlayer();
            if (p instanceof QueuePlayer) ((QueuePlayer) p).clearStarting();
        });
        // The mini player goes back to what played before (a car's or a browse page's start).
        abandon(requested);
        // Media3 drops a refused set without a player error: tell Now playing, which is
        // showing the tapped item as starting, so it says so now and not after 30 s.
        // With the payload's code (unreachable, backend_refused, not_found...), so the line says why.
        String code = e instanceof BrowseAnswer.Failed && e.getMessage() != null ? e.getMessage().trim()
                : e instanceof net.kckern.daylight.api.PayloadPort.NotReadyException ? "starting" : "";
        SessionExtras.putLongAndString(session, Starting.EXTRA_REFUSED_AT, android.os.SystemClock.elapsedRealtime(),
                Starting.EXTRA_REFUSED_WHY, code);
    }

    /**
     * A track tapped in its list (FirstTap): the track alone and the whole list are asked
     * at once. The first useful answer plays; when the track alone came first, the list's
     * other tracks are put around it as soon as the list is in.
     */
    private void race(MediaSession session, String leafId, boolean ownOrder, List<MediaItem> requested,
                      SettableFuture<MediaSession.MediaItemsWithStartPosition> future) {
        final FirstTap tap = new FirstTap();
        final long t0 = android.os.SystemClock.elapsedRealtime();
        final java.util.concurrent.atomic.AtomicReference<TrackAnswer> alone = new java.util.concurrent.atomic.AtomicReference<>();
        try {
            io.execute(() -> {
                TrackAnswer list = null;
                Throwable why = null;
                try { list = resolveIds(Collections.singletonList(leafId), C.INDEX_UNSET, false, false); }
                catch (Throwable e) { why = e; }
                FirstTap.Use use = tap.full(list != null);
                Log.i(TAG, "first tap: the list in " + (android.os.SystemClock.elapsedRealtime() - t0) + " ms -> " + use);
                TrackAnswer whole = list;
                switch (use) {
                    case FULL:
                        answer(session, future, items(whole, requested), ownOrder);
                        break;
                    case SPLICE:
                        main.post(() -> splice(session, whole));
                        break;
                    case SINGLE:
                        answer(session, future, items(alone.get(), requested), ownOrder);
                        break;
                    case FAIL:
                        refused(session, future, why == null ? new IllegalStateException("nothing to play") : why, requested);
                        break;
                    default: break;
                }
            });
            firstIo.execute(() -> {
                TrackAnswer one = null;
                try { one = resolveIds(Collections.singletonList(FirstTap.alone(leafId)), C.INDEX_UNSET, false, false); }
                catch (Throwable notAlone) { /* the list's answer decides */ }
                alone.set(one);
                boolean music = one != null && !one.tracks.isEmpty()
                        && FirstTap.playsAlone(one.tracks.size(), one.tracks.get(0).durationMs, one.startPositionMs);
                FirstTap.Use use = tap.single(one != null, music);
                Log.i(TAG, "first tap: the track alone in " + (android.os.SystemClock.elapsedRealtime() - t0) + " ms"
                        + (music ? "" : " (long or with a place: waits for the list)") + " -> " + use);
                if (use == FirstTap.Use.SINGLE) answer(session, future, items(one, requested), ownOrder);
                else if (use == FirstTap.Use.FAIL) refused(session, future, new IllegalStateException("nothing to play"), requested);
            });
        } catch (RuntimeException stopping) {
            future.setException(stopping);
            abandon(requested);
        }
    }

    private static MediaSession.MediaItemsWithStartPosition items(TrackAnswer r, List<MediaItem> requested) {
        long position = r.startPositionMs > 0 ? r.startPositionMs : C.TIME_UNSET;
        return new MediaSession.MediaItemsWithStartPosition(
                QueueTag.tag(NodeItems.tracks(r.tracks), r.startIndex, requested, false), r.startIndex, position);
    }

    /**
     * Puts the list's other tracks around the one already playing: those before it at the
     * front, those after it behind. The playing track stays current and is not restarted.
     * Nothing is done when the queue has changed meanwhile (another tap, a skip).
     */
    private static void splice(MediaSession session, TrackAnswer list) {
        QueueController queue = QueueController.live();
        if (queue != null) {
            // The queue keeps your queued items around the track: the list's rest becomes its source.
            List<MediaItem> all = NodeItems.tracks(list.tracks);
            List<String> listIds = new ArrayList<>();
            for (MediaItem m : all) listIds.add(m.mediaId);
            MediaItem playing = queue.model().nowEntry() == null ? null : queue.model().nowEntry().item;
            int at = FirstTap.spliceAt(listIds, list.startIndex, playing == null ? null : playing.mediaId);
            Log.i(TAG, "first tap: " + (at >= 0 && queue.splice(all, at) ? "the list's rest is the source" : "the queue changed; the list is not added"));
            return;
        }
        androidx.media3.common.Player p;
        try { p = session.getPlayer(); } catch (RuntimeException released) { return; }
        MediaItem current = p.getCurrentMediaItem();
        if (p.getMediaItemCount() != 1 || current == null) { Log.i(TAG, "first tap: the queue changed; the list is not added"); return; }
        List<MediaItem> items = NodeItems.tracks(list.tracks);
        List<String> ids = new ArrayList<>();
        for (MediaItem m : items) ids.add(m.mediaId);
        int at = FirstTap.spliceAt(ids, list.startIndex, current.mediaId);
        if (at < 0) { Log.i(TAG, "first tap: the list does not hold the playing track; not added"); return; }
        if (at + 1 < items.size()) p.addMediaItems(1, new ArrayList<>(items.subList(at + 1, items.size())));
        if (at > 0) p.addMediaItems(0, new ArrayList<>(items.subList(0, at)));
        Log.i(TAG, "first tap: " + at + " before and " + (items.size() - at - 1) + " after the playing track added");
    }

    /**
     * Only the media ids are read from what a controller sends. A URI or metadata it
     * put on an item is dropped: what plays is what the payload answers for the id.
     * The one exception is a play-from-search (one item, no id, a search query): the
     * payload searches and names the item to play, which is then resolved like any id.
     */
    private TrackAnswer resolve(List<MediaItem> requested, int startIndex, long startPositionMs) throws Exception {
        return resolve(requested, startIndex, startPositionMs, false);
    }

    private TrackAnswer resolve(List<MediaItem> requested, int startIndex, long startPositionMs, boolean shuffle) throws Exception {
        List<String> ids = new ArrayList<>();
        List<String> queries = new ArrayList<>();
        for (MediaItem item : requested) {
            ids.add(item.mediaId);
            queries.add(item.requestMetadata == null ? null : item.requestMetadata.searchQuery);
        }
        if (radio != null && ids.size() == 1 && DrivingRadioSettings.MEDIA_ID.equals(ids.get(0))) {
            return radio.resolve();
        }
        if (radio != null && ids.size() == 1 && radio.isStaple(ids.get(0))) {
            return radio.resolveStaple(ids.get(0));
        }
        String query = SearchAnswer.playFromSearch(ids, queries);
        if (query != null) {
            // The words are never logged; their length is.
            Log.i(TAG, "play from search, " + query.length() + " characters");
            if (radio != null) {
                MediaItem staple = radio.exactStaple(query);
                if (staple != null) return radio.resolveStaple(staple.mediaId);
            }
            String best = SearchAnswer.best(media.search(query, PLAY_WAIT_MS));
            if (best == null) throw new IllegalStateException("nothing found");
            ids = java.util.Collections.singletonList(best);
        }
        int selected = startIndex >= 0 && startIndex < ids.size() ? startIndex : C.INDEX_UNSET;
        boolean explicitPosition = startPositionMs >= 0 && (startIndex == C.INDEX_UNSET || selected >= 0);
        return resolveIds(ids, selected, explicitPosition, shuffle);
    }

    /**
     * Off the main thread (the io executor). A backend restarting (a deploy) answers
     * nothing for a few seconds: one more try after RETRY_MS rather than a failed play.
     */
    private TrackAnswer resolveIds(List<String> ids, int selected, boolean explicitPosition, boolean shuffle) throws Exception {
        try {
            return TrackAnswer.parse(media.resolve(ids, selected, explicitPosition, shuffle, PLAY_WAIT_MS));
        } catch (BrowseAnswer.Failed failed) {
            if (!RETRYABLE.contains(failed.getMessage())) throw failed;
            Log.i(TAG, "play request: " + failed.getMessage() + ", trying once more");
            Thread.sleep(RETRY_MS);
            return TrackAnswer.parse(media.resolve(ids, selected, explicitPosition, shuffle, PLAY_WAIT_MS));
        }
    }

    private static final long RETRY_MS = 2_000;
    /** Payload answers that mean "the backend was not there", not "this cannot play". */
    private static final java.util.Set<String> RETRYABLE = new java.util.HashSet<>(
            java.util.Arrays.asList("backend_refused", "unreachable"));

    // ── voice search ──────────────────────────────────────────────────────────
    //
    // Media3 lets only connected controllers search, and onConnect admitted each one
    // (ControllerPolicy). The query goes to the payload and is never logged; its length is.

    @Override
    public ListenableFuture<LibraryResult<Void>> onSearch(final MediaLibrarySession session,
            final MediaSession.ControllerInfo browser, final String query, final LibraryParams params) {
        final SettableFuture<LibraryResult<Void>> future = SettableFuture.create();
        try {
            io.execute(() -> {
                int count;
                try {
                    MediaItem staple = radio == null ? null : radio.exactStaple(query);
                    count = staple == null ? BrowseAnswer.parse(media.search(query, BROWSE_WAIT_MS)).size() : 1;
                } catch (Throwable failedOrNoPayload) {
                    count = 0;
                }
                Log.i(TAG, "search, " + (query == null ? 0 : query.length()) + " characters, " + count + " results");
                final int results = count;
                // A session is used from the application's main thread.
                new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                    try {
                        session.notifySearchResultChanged(browser, query, results, params);
                    } catch (Throwable released) {
                        // The session or the browser went away while searching.
                    }
                });
            });
            future.set(LibraryResult.ofVoid());
        } catch (RuntimeException stopping) {
            future.set(LibraryResult.<Void>ofError(LibraryResult.RESULT_ERROR_INVALID_STATE));
        }
        return future;
    }

    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetSearchResult(
            MediaLibrarySession session, MediaSession.ControllerInfo browser, final String query,
            final int page, final int pageSize, final LibraryParams params) {
        final SettableFuture<LibraryResult<ImmutableList<MediaItem>>> future = SettableFuture.create();
        try {
            io.execute(() -> {
                try {
                    MediaItem staple = radio == null ? null : radio.exactStaple(query);
                    if (staple != null) {
                        future.set(LibraryResult.ofItemList(page == 0 ? Collections.singletonList(staple)
                                : Collections.emptyList(), params));
                        return;
                    }
                    // The payload keeps the answer for a minute, so asking again for a page is cheap.
                    List<BrowseAnswer.Entry> entries = BrowseAnswer.parse(media.search(query, BROWSE_WAIT_MS));
                    future.set(LibraryResult.ofItemList(NodeItems.nodes(SearchAnswer.page(entries, page, pageSize)), params));
                } catch (PayloadPort.NotReadyException noPayload) {
                    future.set(LibraryResult.ofItemList(ImmutableList.<MediaItem>of(), params));
                } catch (BrowseAnswer.Failed refused) {
                    future.set(LibraryResult.<ImmutableList<MediaItem>>ofError(LibraryResult.RESULT_ERROR_IO));
                } catch (Throwable broke) {
                    Log.w(TAG, "search failed: " + broke.getClass().getSimpleName());
                    future.set(LibraryResult.<ImmutableList<MediaItem>>ofError(LibraryResult.RESULT_ERROR_UNKNOWN));
                }
            });
        } catch (RuntimeException stopping) {
            future.set(LibraryResult.<ImmutableList<MediaItem>>ofError(LibraryResult.RESULT_ERROR_INVALID_STATE));
        }
        return future;
    }

    private static Exception failure(Throwable e) {
        // The payload's answer is an error code (bad_request, backend_refused, unreachable...),
        // never an id or a title: it says which way a play failed.
        String why = e instanceof BrowseAnswer.Failed ? " " + e.getMessage() : "";
        Log.w(TAG, "could not resolve a play request: " + e.getClass().getSimpleName() + why);
        return e instanceof Exception ? (Exception) e : new IllegalStateException(e.getClass().getSimpleName());
    }
}
