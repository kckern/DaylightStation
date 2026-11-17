package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Build;
import android.os.Process;
import android.util.Log;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.session.LibraryResult;
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
    private final AtomicBoolean waitingForPayload = new AtomicBoolean();

    LibraryCallback(PayloadMedia media, ExecutorService io, String myPackage) {
        this.media = media;
        this.io = io;
        this.myPackage = myPackage;
    }

    @Override
    public MediaSession.ConnectionResult onConnect(MediaSession session, MediaSession.ControllerInfo controller) {
        if (!ControllerPolicy.allows(controller.getPackageName(), controller.getUid(), Process.myUid(), myPackage, Build.VERSION.SDK_INT)) {
            Log.w(TAG, "refused a media controller that is not this app, the system or a known car or assistant app");
            return MediaSession.ConnectionResult.reject();
        }
        return MediaLibrarySession.Callback.super.onConnect(session, controller);
    }

    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(
            MediaLibrarySession session, MediaSession.ControllerInfo browser, LibraryParams params) {
        // The root is fixed, so a car gets an answer before the payload is up.
        return Futures.immediateFuture(LibraryResult.ofItem(NodeItems.root(), params));
    }

    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(
            final MediaLibrarySession session, MediaSession.ControllerInfo browser, final String parentId,
            final int page, final int pageSize, final LibraryParams params) {
        final SettableFuture<LibraryResult<ImmutableList<MediaItem>>> future = SettableFuture.create();
        try {
            io.execute(() -> {
                try {
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
                    future.set(LibraryResult.ofItemList(NodeItems.nodes(entries), params));
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
                try { future.set(NodeItems.tracks(resolve(requested).tracks)); }
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
        final SettableFuture<MediaSession.MediaItemsWithStartPosition> future = SettableFuture.create();
        try {
            io.execute(() -> {
                try {
                    TrackAnswer r = resolve(requested);
                    future.set(new MediaSession.MediaItemsWithStartPosition(NodeItems.tracks(r.tracks), r.startIndex,
                            r.startPositionMs > 0 ? r.startPositionMs : C.TIME_UNSET));
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
     */
    private TrackAnswer resolve(List<MediaItem> requested) throws Exception {
        List<String> ids = new ArrayList<>();
        for (MediaItem item : requested) ids.add(item.mediaId);
        return TrackAnswer.parse(media.resolve(ids, PLAY_WAIT_MS));
    }

    private static Exception failure(Throwable e) {
        Log.w(TAG, "could not resolve a play request: " + e.getClass().getSimpleName());
        return e instanceof Exception ? (Exception) e : new IllegalStateException(e.getClass().getSimpleName());
    }
}
