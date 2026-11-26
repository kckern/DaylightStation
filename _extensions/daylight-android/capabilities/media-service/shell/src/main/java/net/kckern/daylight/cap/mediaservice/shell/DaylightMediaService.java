package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.AndroidPackageFacts;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.util.List;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Timeline;
import androidx.media3.exoplayer.ExoPlayer;
import net.kckern.daylight.shellkit.DrivingRadioSettings;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;

import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.SurfaceCache;
import net.kckern.daylight.shellkit.PlaylistWidgetState;
import net.kckern.daylight.shellkit.PlaylistArtwork;
import net.kckern.daylight.shellkit.PlaylistWidgetState.Phase;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The installed half of native playback. Android creates it by class name when a
 * car, the system's media controls or a headset button binds it, which can happen in
 * a process with no payload. It owns only what Media3 needs in the installed package
 * (the player, the session, the media notification, the foreground state) and asks
 * the payload for everything else through PayloadMedia.
 *
 * Rule for editing this file: host, do not decide. What may be browsed, what an id
 * plays and when progress is reported are the payload's; who may connect is
 * ControllerPolicy's.
 *
 * Cold start: onCreate asks for the shell service, which loads the payload. Android
 * may refuse that from the background; the callbacks then answer with their fallback
 * (LibraryCallback) and nothing here throws.
 */
public class DaylightMediaService extends MediaLibraryService {
    private static final String TAG = "Daylight-Media";

    // The non-exported start service and this Media3 service share the app process and main looper.
    private static DaylightMediaService current;

    private ExoPlayer player;
    private PayloadMedia media;
    private PlayStart.Attempt shortcutOwner;
    private String displayedPlaylist;
    private PlayStart.Attempt artworkOwner;
    private Uri artworkUri;
    private MediaLibrarySession session;
    private LibraryCallback callback;
    /** The layout the car was last given; null before the first. */
    private Boolean carLongForm;
    private PlaybackEvents events;
    private ExecutorService io;
    private DrivingRadio radio;
    private android.content.SharedPreferences radioPrefs;
    private final android.content.SharedPreferences.OnSharedPreferenceChangeListener driveChanged = (prefs, key) -> {
        if (session != null && DrivingRadioSettings.affectsDrive(key)) {
            cancelRadioHandoff();
            session.notifyChildrenChanged(DrivingRadio.DRIVE, radio.staples().size() + (radio.enabled() ? 1 : 0), null);
        }
    };
    private final Handler widgetUpdates = new Handler(Looper.getMainLooper());
    private final Runnable widgetTick = this::publishPlaylistProgress;
    private int widgetTrackNumber;
    private long handoffGeneration;
    private boolean playedQueue;

    @Override
    public void onCreate() {
        super.onCreate();
        ShellStart.ensure(this);
        io = Executors.newFixedThreadPool(2, r -> {
            Thread t = new Thread(r, "Daylight-media-io");
            t.setDaemon(true);
            return t;
        });
        media = new PayloadMedia();
        radio = new DrivingRadio(new DrivingRadioSettings(this), media);

        // Audio focus and "headphones unplugged" are the player's: it pauses for a call,
        // ducks for a prompt and stops when the output goes away. The wake mode holds the
        // CPU and the network while playing with the screen off.
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .setSeekBackIncrementMs(CarControls.SEEK_STEP_MS)
                .setSeekForwardIncrementMs(CarControls.SEEK_STEP_MS)
                .build();

        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player player, Player.Events events) {
                publishPlaylistState();
                refreshCarLayout();
                CharSequence title = player.getMediaItemCount() == 0 ? null : player.getMediaMetadata().title;
                net.kckern.daylight.shellkit.NowPlayingNote.update("local", "This phone", title == null ? "" : title.toString(),
                        player.isPlaying() || (player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_BUFFERING),
                        android.os.SystemClock.elapsedRealtime());
            }

            @Override public void onTimelineChanged(androidx.media3.common.Timeline timeline, int reason) {
                if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) {
                    cancelRadioHandoff();
                    playedQueue = false;
                }
            }

            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) continueDrivingRadio();
            }

            @Override public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (!playWhenReady) cancelRadioHandoff();
            }

            @Override public void onPlayerError(PlaybackException error) {
                MediaItem failed = player.getCurrentMediaItem();
                if (failed == null || failed.localConfiguration == null
                        || !"audio".equals(failed.localConfiguration.uri.getQueryParameter("stream"))) return;
                widgetUpdates.post(() -> {
                    if (current != DaylightMediaService.this || player.getCurrentMediaItem() != failed
                            || player.getPlayerError() != error || !player.getPlayWhenReady()
                            || !player.hasNextMediaItem()) return;
                    player.seekToNextMediaItem();
                    player.prepare();
                    player.play();
                });
            }

            @Override public void onIsPlayingChanged(boolean playing) {
                if (playing) {
                    playedQueue = true;
                    radio.remember(player.getCurrentMediaItem());
                }
                PlayStart.Attempt attempt = shortcutOwner;
                if (playing && attempt != null && ownsPlaylist(attempt)) {
                    attempt.recordPlaying(SystemClock.elapsedRealtime());
                }
            }
        });

        Player sessionPlayer = new ForwardingPlayer(player) {
            @Override public long getDuration() {
                return NodeItems.durationMs(player.getCurrentMediaItem(), super.getDuration());
            }

            @Override public long getContentDuration() {
                return NodeItems.durationMs(player.getCurrentMediaItem(), super.getContentDuration());
            }

            // Long-form withholds track skips so a car puts back/forward 10s beside play,
            // and a steering-wheel skip becomes a 10s jump. See CarControls.
            @Override public Player.Commands getAvailableCommands() {
                Player.Commands all = super.getAvailableCommands();
                return longForm() ? CarControls.withoutTrackSkips(all) : all;
            }

            @Override public boolean isCommandAvailable(int command) {
                return !(longForm() && CarControls.isTrackSkip(command)) && super.isCommandAvailable(command);
            }

            @Override public void seekToNext() { if (!skip("next", true)) super.seekToNext(); }
            @Override public void seekToNextMediaItem() { if (!skip("next-item", true)) super.seekToNextMediaItem(); }
            @Override public void seekToPrevious() { if (!skip("previous", false)) super.seekToPrevious(); }
            @Override public void seekToPreviousMediaItem() { if (!skip("previous-item", false)) super.seekToPreviousMediaItem(); }
            @Override public void seekBack() { Log.i(TAG, "transport back-10"); super.seekBack(); }
            @Override public void seekForward() { Log.i(TAG, "transport forward-10"); super.seekForward(); }

            /** True when a skip was turned into a 10s jump. Every skip is logged: it is how a car's wheel buttons show up. */
            private boolean skip(String kind, boolean forward) {
                boolean jump = longForm();
                Log.i(TAG, "transport " + kind + (jump ? (forward ? " -> forward-10" : " -> back-10") : " -> track"));
                if (!jump) return false;
                if (forward) player.seekForward(); else player.seekBack();
                return true;
            }
        };
        callback = new LibraryCallback(media, io, getPackageName(), new AndroidPackageFacts(getPackageManager()),
                () -> SurfaceCache.get(this, ControllerPins.KEY), DaylightMediaService::stopPlayback)
                .withDrivingRadio(radio, this::cancelRadioHandoff);
        MediaLibrarySession.Builder builder = new MediaLibrarySession.Builder(this, sessionPlayer, callback);
        builder.setCustomLayout(CarControls.layout(false));
        // A tap on the media notification opens the Now playing screen on this phone's
        // playback. Nothing from a controller is in the intent.
        Intent open = new Intent(this, NowPlayingActivity.class)
                .putExtra(NowPlayingActivity.EXTRA_TARGET, NowPlayingActivity.LOCAL)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        builder.setSessionActivity(PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session = builder.build();
        radioPrefs = getSharedPreferences(DrivingRadioSettings.PLAYLIST_PREFS, MODE_PRIVATE);
        radioPrefs.registerOnSharedPreferenceChangeListener(driveChanged);

        setListener(new Listener() {
            @Override public void onForegroundServiceStartNotAllowedException() {
                foreground = false;
                Log.w(TAG, "Android refused the media service's foreground start");
            }
        });

        events = new PlaybackEvents(player, media, io);
        events.attach();
        current = this;
        Log.i(TAG, "media service created");
    }

    /**
     * Resolve through the same payload as car and phone browsing. The attempt is checked on the
     * player's thread before changing anything, so a late lookup cannot prepare or play a queue.
     */
    static void playShortcut(PlayStart.Attempt attempt, String mediaId, Runnable failed) {
        DaylightMediaService service = current;
        if (service == null) { failed.run(); return; }
        service.io.execute(() -> {
            TrackAnswer tracks;
            try {
                tracks = service.media.resolveShortcut(mediaId, attempt.shuffle, 8000);
            } catch (Exception failure) {
                tracks = null;
            }
            TrackAnswer answer = tracks;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (current != service || !attempt.canApply(SystemClock.elapsedRealtime())) return;
                if (answer == null) { failed.run(); return; }
                try {
                    List<MediaItem> items = NodeItems.tracks(answer.tracks);
                    items.set(0, items.get(0).buildUpon().setTag(attempt).build());
                    service.shortcutOwner = attempt;
                    ExoPlayer player = service.player;
                    player.pause();
                    player.setShuffleModeEnabled(false);
                    player.setMediaItems(items, answer.startIndex, answer.startPositionMs > 0
                            ? answer.startPositionMs : C.TIME_UNSET);
                    player.prepare();
                    player.play();
                } catch (RuntimeException failure) {
                    failed.run();
                }
            });
        });
    }

    private void cancelRadioHandoff() {
        handoffGeneration++;
    }

    private boolean canContinueDrivingRadio() {
        return session != null && session.getConnectedControllers().stream().anyMatch(DrivingRadio::isCar)
                && player.getPlayWhenReady() && player.getPlayerError() == null && playedQueue
                && player.getPlaybackState() == Player.STATE_ENDED && radio.enabled();
    }

    private void continueDrivingRadio() {
        if (!canContinueDrivingRadio()) return;
        long generation = ++handoffGeneration;
        io.execute(() -> {
            final TrackAnswer answer;
            try {
                answer = radio.resolve();
            } catch (Exception unavailable) {
                Log.w(TAG, "Driving Radio queue unavailable");
                return;
            }
            widgetUpdates.post(() -> {
                if (generation != handoffGeneration || !canContinueDrivingRadio()) return;
                player.setShuffleModeEnabled(false);
                player.setMediaItems(NodeItems.tracks(answer.tracks), answer.startIndex,
                        answer.startPositionMs > 0 ? answer.startPositionMs : C.TIME_UNSET);
                player.prepare();
                player.play();
            });
        });
    }

    static void stopPlayback() {
        PlayActionService.cancelCurrentStart();
        DaylightMediaService service = current;
        if (service != null) service.stopPlayer();
    }

    private void stopPlayer() {
        cancelRadioHandoff();
        player.pause();
        player.stop();
        player.clearMediaItems();
        shortcutOwner = null;
        publishPlaylistState();
    }

    /** Whether what is playing is long-form audio (talks, scripture, courses). See CarControls. */
    private boolean longForm() {
        MediaItem item = player.getCurrentMediaItem();
        return item != null && CarControls.longForm(NodeItems.listId(item), NodeItems.durationMs(item, player.getDuration()));
    }

    /**
     * Sets the car's buttons for what is playing. A new custom layout also makes the
     * legacy session the car reads recompute its actions, so the slots beside play
     * follow the item.
     */
    private void refreshCarLayout() {
        if (session == null) return;
        boolean now = longForm();
        if (carLongForm != null && carLongForm == now) return;
        carLongForm = now;
        session.setCustomLayout(CarControls.layout(now));
        Log.i(TAG, "transport layout " + (now ? "long-form" : "music"));
    }

    private boolean ownsPlaylist(PlayStart.Attempt attempt) {
        if (shortcutOwner != attempt || player.getMediaItemCount() == 0) return false;
        MediaItem.LocalConfiguration first = player.getMediaItemAt(0).localConfiguration;
        return first != null && first.tag == attempt;
    }

    private void publishPlaylistState() {
        PlayStart.Attempt owner = shortcutOwner;
        String playlist = owner != null && ownsPlaylist(owner) ? owner.playlist : null;
        if (displayedPlaylist != null && !displayedPlaylist.equals(playlist))
            PlaylistWidgetState.show(this, displayedPlaylist, Phase.READY);
        displayedPlaylist = playlist;
        if (playlist == null) {
            widgetUpdates.removeCallbacks(widgetTick);
            PlaylistWidgetState.progress(this, null, null);
            updateTrackArtwork(null, null);
            return;
        }
        Phase phase;
        if (player.getPlayerError() != null) phase = Phase.FAILED;
        else if (player.getPlaybackState() == Player.STATE_ENDED) phase = Phase.READY;
        else if (player.isPlaying()) phase = Phase.PLAYING;
        else if (player.getPlayWhenReady()) phase = Phase.STARTING;
        else if (owner.played()) phase = Phase.PAUSED;
        else phase = Phase.STARTING;
        if (phase == Phase.PLAYING || phase == Phase.PAUSED)
            updateTrackArtwork(owner, player.getMediaMetadata().artworkUri);
        else if (phase == Phase.READY || phase == Phase.FAILED) updateTrackArtwork(null, null);
        widgetTrackNumber = phase == Phase.PLAYING || phase == Phase.PAUSED
                ? playlistTrackNumber() : 0;
        publishPlaylistProgress();
        PlaylistWidgetState.show(this, playlist, phase);
    }

    private int playlistTrackNumber() {
        if (!player.getShuffleModeEnabled()) return player.getCurrentMediaItemIndex() + 1;

        Timeline timeline = player.getCurrentTimeline();
        int playingIndex = player.getCurrentMediaItemIndex();
        int index = timeline.getFirstWindowIndex(true);
        for (int track = 1; track <= timeline.getWindowCount(); track++) {
            if (index == playingIndex) return track;
            if (index == C.INDEX_UNSET) break;
            index = timeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, true);
        }
        return 0;
    }

    private void publishPlaylistProgress() {
        widgetUpdates.removeCallbacks(widgetTick);
        if (displayedPlaylist == null || widgetTrackNumber == 0) {
            PlaylistWidgetState.progress(this, null, null);
            return;
        }
        PlaylistWidgetState.progress(this, displayedPlaylist, new PlaylistWidgetState.Progress(
                player.getCurrentPosition(), NodeItems.durationMs(player.getCurrentMediaItem(), player.getDuration()),
                widgetTrackNumber, player.getMediaItemCount()));
        if (player.isPlaying()) widgetUpdates.postDelayed(widgetTick, 2000);
    }

    private void updateTrackArtwork(PlayStart.Attempt owner, Uri uri) {
        if (owner == artworkOwner && java.util.Objects.equals(uri, artworkUri)) return;
        artworkOwner = owner;
        artworkUri = uri;
        PlaylistWidgetState.trackArtwork(this, null, null);
        if (owner == null || uri == null) return;
        io.execute(() -> {
            Bitmap bitmap = PlaylistArtwork.load(uri.toString(), 240);
            if (bitmap == null) return;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (current == this && artworkOwner == owner && uri.equals(artworkUri) && ownsPlaylist(owner))
                    PlaylistWidgetState.trackArtwork(this, owner.playlist, bitmap);
            });
        });
    }

    static void controlPlaylist(String playlist, PlaylistWidgetState.Tap command) {
        DaylightMediaService service = current;
        PlayStart.Attempt owner = service == null ? null : service.shortcutOwner;
        if (owner == null || !playlist.equals(owner.playlist) || !service.ownsPlaylist(owner)) return;
        if (command == PlaylistWidgetState.Tap.PAUSE) service.player.pause();
        else service.player.play();
        service.publishPlaylistState();
    }

    static boolean shortcutPlaying(PlayStart.Attempt attempt) {
        DaylightMediaService service = current;
        return service != null && service.ownsPlaylist(attempt) && service.player.isPlaying();
    }

    static boolean shortcutFailed(PlayStart.Attempt attempt) {
        DaylightMediaService service = current;
        return service != null && service.ownsPlaylist(attempt) && service.player.getPlayerError() != null;
    }

    static void stopShortcut(PlayStart.Attempt attempt) {
        DaylightMediaService service = current;
        if (service != null && service.ownsPlaylist(attempt)) {
            service.stopPlayer();
        }
    }

    /** Whether the media service holds the foreground state now. Read by PlayActionService, in process. */
    private static volatile boolean foreground;

    static boolean inForeground() { return foreground; }

    /**
     * Media3 1.1.1 moves this service into the foreground when the player starts, by
     * calling startForegroundService on itself. From Android 12 that start can be refused
     * while the app is in the background. Media3 catches the refusal itself (read from its
     * bytecode: MediaSessionService.onUpdateNotificationInternal) and tells the Listener
     * set in onCreate, which clears the flag. A play service started by a tap keeps its
     * own foreground state while the audio plays when the flag is false (PlayStart).
     */
    @Override
    public void onUpdateNotification(MediaSession session, boolean startInForegroundRequired) {
        foreground = startInForegroundRequired;
        super.onUpdateNotification(session, startInForegroundRequired);
    }

    @Override
    public MediaLibrarySession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    /** The app was swiped away: keep playing if something is playing, otherwise go. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        ExoPlayer p = player;
        if (p == null || !p.getPlayWhenReady() || p.getMediaItemCount() == 0) stopSelf();
    }

    @Override
    public void onDestroy() {
        if (radioPrefs != null) radioPrefs.unregisterOnSharedPreferenceChangeListener(driveChanged);
        if (current == this) current = null;
        widgetUpdates.removeCallbacks(widgetTick);
        PlaylistWidgetState.progress(this, null, null);
        PlaylistWidgetState.show(this, displayedPlaylist, Phase.READY);
        updateTrackArtwork(null, null);
        clearListener();
        if (events != null) { events.detach(); events = null; }
        if (callback != null) { callback.sleep.release(); callback = null; }
        net.kckern.daylight.shellkit.NowPlayingNote.update("local", "", "", false, android.os.SystemClock.elapsedRealtime());
        if (session != null) { session.release(); session = null; }
        if (player != null) { player.release(); player = null; }
        if (io != null) { io.shutdown(); io = null; }
        foreground = false;
        Log.i(TAG, "media service destroyed");
        super.onDestroy();
    }
}
