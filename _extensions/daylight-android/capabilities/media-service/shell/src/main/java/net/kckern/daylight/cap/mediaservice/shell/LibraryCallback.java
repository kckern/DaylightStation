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
                    future.set(LibraryResult.ofItemList(nodes, params));
                } catch (BrowseAnswer.Failed refused) {
                    future.set(LibraryResult.<ImmutableList<MediaItem>>ofError(LibraryResult.RESULT_ERROR_IO));
                } catch (Throwable broke) {
                    // The payload is replaceable code; whatever it throws must not take the service down.
                    Log.w(TAG, "browse failed: " + broke.getClass().getSimpleName());
                    future.set(LibraryResult.<ImmutableList<MediaItem>>ofError(LibraryResult.RESULT_ERROR_UNKNOWN));
                }
            });
        } catch (RuntimeException stopping) {
            future.set(LibraryResult.<ImmutableList<MediaItem>>ofError(LibraryResult.RESULT_ERROR_INVALID_STATE));
        }
        return future;
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
                catch (Throwable e) { future.setException(failure(e)); }
            });
        } catch (RuntimeException stopping) {
            future.setException(stopping);
        }
        return future;
    }

    @Override
    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(
            MediaSession session, MediaSession.ControllerInfo controller, final List<MediaItem> requested,
            int startIndex, long startPositionMs) {
        cancelHandoff.run();
        final SettableFuture<MediaSession.MediaItemsWithStartPosition> future = SettableFuture.create();
        try {
            io.execute(() -> {
                try {
                    TrackAnswer r = resolve(requested, startIndex, startPositionMs);
                    long defaultPosition = r.startPositionMs > 0 ? r.startPositionMs : C.TIME_UNSET;
                    long position = r.selectionResolved && startPositionMs >= 0 ? startPositionMs : defaultPosition;
                    future.set(new MediaSession.MediaItemsWithStartPosition(NodeItems.tracks(r.tracks), r.startIndex, position));
                } catch (Throwable e) {
                    future.setException(failure(e));
                }
            });
        } catch (RuntimeException stopping) {
            future.setException(stopping);
        }
        return future;
    }

    /**
     * Only the media ids are read from what a controller sends. A URI or metadata it
     * put on an item is dropped: what plays is what the payload answers for the id.
     * The one exception is a play-from-search (one item, no id, a search query): the
     * payload searches and names the item to play, which is then resolved like any id.
     */
    private TrackAnswer resolve(List<MediaItem> requested, int startIndex, long startPositionMs) throws Exception {
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
        // Off the main thread (the io executor). A backend restarting (a deploy) answers
        // nothing for a few seconds: one more try after RETRY_MS rather than a failed play.
        try {
            return TrackAnswer.parse(media.resolve(ids, selected, explicitPosition, PLAY_WAIT_MS));
        } catch (BrowseAnswer.Failed failed) {
            if (!RETRYABLE.contains(failed.getMessage())) throw failed;
            Log.i(TAG, "play request: " + failed.getMessage() + ", trying once more");
            Thread.sleep(RETRY_MS);
            return TrackAnswer.parse(media.resolve(ids, selected, explicitPosition, PLAY_WAIT_MS));
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
