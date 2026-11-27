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
import androidx.media3.common.MediaMetadata;
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
    private LongFormPolicy longFormPolicy;
    private volatile float levelVolume = 1f, fadeVolume = 1f, crossfadeGain = 1f;
    private CrossfadeEngine crossfade;
    private final java.util.Map<String, Float> levels = new java.util.concurrent.ConcurrentHashMap<>();

    private void applyVolume() {
        // Loudness level x the sleep timer's fade x the crossfade's (or a skip's) ramp.
        if (player != null) player.setVolume(levelVolume * fadeVolume * crossfadeGain);
    }

    /** The level for this item from its Plex gain (track levels route), kept per item. */
    // ── chapters (ops:docs/superpowers/specs/2026-11-26-phone-audiobook-chapters.md §4.5) ──

    private volatile Chapters chapters = Chapters.NONE;
    private volatile String chaptersFor = "";
    private int publishedChapter = -1;
    private Player sessionPlayerRef;
    private final java.util.List<Player.Listener> sessionListeners = new java.util.concurrent.CopyOnWriteArrayList<>();
    private final Runnable chapterTick = this::chapterTick;

    /** A long item's chapters, asked of the payload (home, else the kept copy); none for music. */
    private void loadChapters(MediaItem item) {
        widgetUpdates.removeCallbacks(chapterTick);
        boolean had = !chapters.isEmpty();
        chapters = Chapters.NONE;
        chaptersFor = "";
        publishedChapter = -1;
        if (had) emitMetadata();
        String id = item == null ? null : item.mediaId;
        ExecutorService pool = io;
        if (id == null || id.indexOf(':') <= 0 || pool == null) return;
        long fileMs = NodeItems.durationMs(item, androidx.media3.common.C.TIME_UNSET);
        if (fileMs > 0 && fileMs < 20 * 60_000L) return;
        pool.execute(() -> {
            Chapters found;
            try {
                found = Chapters.parse(new org.json.JSONObject(media.trackChapters(id, 8000)), Math.max(0, fileMs));
            } catch (Exception none) { found = Chapters.NONE; }
            Chapters got = found;
            widgetUpdates.post(() -> {
                MediaItem now = player == null ? null : player.getCurrentMediaItem();
                if (now == null || !id.equals(now.mediaId) || got.isEmpty()) return;
                chapters = got;
                chaptersFor = id;
                Log.i(TAG, "chapters: " + got.count() + " for the current item");
                chapterTick();
            });
        });
    }

    /** Re-publishes the subtitle when the position crosses into another chapter. */
    private void chapterTick() {
        Chapters c = chapters;
        if (c.isEmpty() || player == null) return;
        int i = c.indexAt(player.getCurrentPosition());
        if (i != publishedChapter) { publishedChapter = i; emitMetadata(); }
        widgetUpdates.postDelayed(chapterTick, 2000);
    }

    private void emitMetadata() {
        Player sp = sessionPlayerRef;
        if (sp == null) return;
        MediaMetadata m = sp.getMediaMetadata();
        Player.Events events = new Player.Events(new androidx.media3.common.FlagSet.Builder().add(Player.EVENT_MEDIA_METADATA_CHANGED).build());
        for (Player.Listener l : sessionListeners) {
            l.onMediaMetadataChanged(m);
            l.onEvents(sp, events);
        }
    }

    private void level(MediaItem item) {
        String id = item == null ? null : item.mediaId;
        if (id == null || id.indexOf(':') <= 0) { levelVolume = 1f; applyVolume(); return; }
        Float known = levels.get(id);
        if (known != null) { levelVolume = known; applyVolume(); return; }
        levelVolume = 1f;
        applyVolume();
        ExecutorService pool = io;
        if (pool == null) return;
        pool.execute(() -> {
            float v = 1f;
            try {
                org.json.JSONObject reply = new org.json.JSONObject(media.trackLevels(id, 16, 5000));
                org.json.JSONObject q = reply.optJSONObject("levels") == null ? null : reply.optJSONObject("levels").optJSONObject("quality");
                if (q != null && q.has("gainDb")) v = LongForm.levelFor(q.optDouble("gainDb", Double.NaN));
            } catch (Exception unknown) { /* no analysis: full volume */ }
            float level = v;
            levels.put(id, level);
            new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                MediaItem now = player == null ? null : player.getCurrentMediaItem();
                if (now != null && id.equals(now.mediaId)) {
                    levelVolume = level;
                    applyVolume();
                    Log.i(TAG, "loudness level " + Math.round(level * 100) + "%");
                }
            });
        });
    }
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
    /** Skip or hold after a playback error (H2): see PlaybackRecovery. Main thread only. */
    private final PlaybackRecovery recovery = new PlaybackRecovery();
    private MediaItem heldItem;
    private final Runnable retryHeld = this::retryHeld;

    /** A streamed item home could not serve: stay on it and prepare again with backoff. */
    private void holdForHome(MediaItem failed) {
        heldItem = failed;
        widgetUpdates.removeCallbacks(retryHeld);
        long wait = recovery.nextRetryMs();
        Log.i(TAG, "lost connection to home: retrying in " + wait + " ms at " + player.getCurrentPosition() + " ms");
        widgetUpdates.postDelayed(retryHeld, wait);
    }

    /** Prepares the held item again where it was; playWhenReady survives the error, so it plays on if it was playing. */
    private void retryHeld() {
        ExoPlayer p = player;
        MediaItem held = heldItem;
        if (current != this || p == null || held == null || p.getCurrentMediaItem() != held
                || p.getPlayerError() == null) return;
        p.prepare();
    }

    /** The HTTP status behind an IO_BAD_HTTP_STATUS error, or -1. */
    private static int httpStatus(PlaybackException error) {
        for (Throwable t = error.getCause(); t != null; t = t.getCause()) {
            if (t instanceof androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) {
                return ((androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) t).responseCode;
            }
        }
        return -1;
    }
    private boolean playedQueue;

    @Override
    public void onCreate() {
        super.onCreate();
        ShellStart.ensure(this);
        // The notification's second line is the artist; for a chaptered book it leads with
        // the chapter ("Chapter 4 of 12 · The Return · Boethius"), as the session subtitle does.
        setMediaNotificationProvider(new androidx.media3.session.DefaultMediaNotificationProvider(this) {
            @Override protected CharSequence getNotificationContentText(MediaMetadata m) {
                CharSequence chapter = Chapters.notificationLine(m.subtitle, m.artist);
                return chapter != null ? chapter : super.getNotificationContentText(m);
            }
        });
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
        androidx.media3.datasource.DataSource.Factory source = playbackSource();
        player = new ExoPlayer.Builder(this)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .setSeekBackIncrementMs(CarControls.SEEK_STEP_MS)
                .setSeekForwardIncrementMs(CarControls.SEEK_STEP_MS)
                // Tracks kept on this phone play from the download cache, with no network.
                .setMediaSourceFactory(new androidx.media3.exoplayer.source.DefaultMediaSourceFactory(source))
                .build();

        // Crossfade between songs (music only, this phone only): a private tail player plays
        // the outgoing song's last seconds; this player stays the one truth. See CrossfadeEngine.
        crossfade = new CrossfadeEngine(this, player, source, new CrossfadeEngine.Mix() {
            @Override public float levelOf(MediaItem item) {
                Float known = item == null ? null : levels.get(item.mediaId);
                return known == null ? 1f : known;
            }
            @Override public float sleepFade() { return fadeVolume; }
            @Override public void incomingGain(float gain) { crossfadeGain = gain; applyVolume(); }
        }, (item, durationMs) -> { if (events != null) events.finishedByFade(item, durationMs); });
        io.execute(() -> {
            try {
                org.json.JSONObject rules = new org.json.JSONObject(media.playerRules(5000));
                if (rules.optBoolean("ok", false) && rules.has("crossfadeSec")) {
                    CrossfadeEngine.rememberDefault(this, rules.optInt("crossfadeSec", Crossfade.DEFAULT_SEC));
                }
            } catch (Exception keepLast) { /* the last default stays */ }
        });

        // Long items: the listener's speed (music stays 1x) and a short step back on resume.
        longFormPolicy = new LongFormPolicy(player, this::longForm, () -> {
                    MediaItem item = player.getCurrentMediaItem();
                    if (item == null) return "";
                    CharSequence album = item.mediaMetadata.albumTitle;
                    return LongForm.speedKey(NodeItems.listId(item), album == null ? null : album.toString());
                },
                getSharedPreferences(LongFormPolicy.PREFS, MODE_PRIVATE), SystemClock::elapsedRealtime);
        player.addListener(longFormPolicy);
        // Kept automatically while you listen (spec §3.10): see AutoKeeper.
        player.addListener(new AutoKeeper(this, player));
        // Loudness levelling: each track at its Plex gain (never above full), times the
        // sleep timer's fade; the two meet here so neither undoes the other.
        player.addListener(new Player.Listener() {
            @Override public void onMediaItemTransition(MediaItem item, int reason) {
                level(item);
                loadChapters(item);
                recovery.moved();
            }
        });
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player player, Player.Events events) {
                publishPlaylistState();
                refreshCarLayout();
                net.kckern.daylight.shellkit.NowPlayingNote.report(NowPlayingNotes.entry("local", "This phone", player));
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
                if (skipDamagedKept(failed, error)) return;
                if (failed == null || failed.localConfiguration == null
                        || !"audio".equals(failed.localConfiguration.uri.getQueryParameter("stream"))) return;
                int kept;
                try { kept = KeepStore.get(DaylightMediaService.this).where(failed.mediaId); }
                catch (RuntimeException broken) { kept = PlaybackRecovery.NOT_KEPT; }
                PlaybackRecovery.Action action = recovery.onError(error.errorCode, httpStatus(error), kept,
                        player.getPlayWhenReady(), player.hasNextMediaItem());
                Log.w(TAG, "player error " + error.getErrorCodeName() + " -> " + action
                        + (action == PlaybackRecovery.Action.SKIP ? " (" + recovery.skips() + " in a row)" : ""));
                if (action == PlaybackRecovery.Action.HOLD) { holdForHome(failed); return; }
                if (action != PlaybackRecovery.Action.SKIP) return;
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
                    recovery.played();
                    widgetUpdates.removeCallbacks(retryHeld);
                    // Playing makes the app foreground: bring the shell (and its inbox long poll)
                    // back if Android stopped it while the app sat in the background.
                    ShellStart.ensure(DaylightMediaService.this);
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
            // A chaptered book: the subtitle names the chapter (notification, lock screen, car).
            @Override public MediaMetadata getMediaMetadata() {
                MediaMetadata base = super.getMediaMetadata();
                Chapters c = chapters;
                MediaItem cur = player.getCurrentMediaItem();
                if (c.isEmpty() || cur == null || !chaptersFor.equals(cur.mediaId)) return base;
                return base.buildUpon().setSubtitle(c.subtitle(player.getCurrentPosition())).build();
            }

            @Override public void addListener(Player.Listener listener) {
                super.addListener(listener);
                sessionListeners.add(listener);
            }

            @Override public void removeListener(Player.Listener listener) {
                super.removeListener(listener);
                sessionListeners.remove(listener);
            }

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

            // A music skip is a cut with a 150 ms fade-out (never a crossfade); see CrossfadeEngine.cut.
            @Override public void seekToNext() { if (!skip("next", true)) crossfade.cut(() -> super.seekToNext(), false); }
            @Override public void seekToNextMediaItem() { if (!skip("next-item", true)) crossfade.cut(() -> super.seekToNextMediaItem(), false); }
            @Override public void seekToPrevious() { if (!skip("previous", false)) crossfade.cut(() -> super.seekToPrevious(), false); }
            @Override public void seekToPreviousMediaItem() { if (!skip("previous-item", false)) crossfade.cut(() -> super.seekToPreviousMediaItem(), false); }
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
        sessionPlayerRef = sessionPlayer;
        callback = new LibraryCallback(media, io, getPackageName(), new AndroidPackageFacts(getPackageManager()),
                () -> SurfaceCache.get(this, ControllerPins.KEY), DaylightMediaService::stopPlayback)
                .withDrivingRadio(radio, this::cancelRadioHandoff);
        callback.sleep.setFadeSink(v -> { fadeVolume = v; applyVolume(); });
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
        widgetUpdates.removeCallbacks(retryHeld);
        recovery.release();
        PlaylistWidgetState.progress(this, null, null);
        PlaylistWidgetState.show(this, displayedPlaylist, Phase.READY);
        updateTrackArtwork(null, null);
        clearListener();
        if (crossfade != null) { crossfade.release(); crossfade = null; }
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

    /**
     * The kept copy first; if the download store cannot open (a broken cache, a full disk), the
     * player still streams: a keep failure never stops playback.
     */
    private androidx.media3.datasource.DataSource.Factory playbackSource() {
        try {
            return KeepStore.get(this).playback();
        } catch (RuntimeException broken) {
            android.util.Log.w("Daylight-Media", "keep: the download store did not open; streaming only ("
                    + broken.getClass().getSimpleName() + ")");
            return new androidx.media3.datasource.DefaultDataSource.Factory(this);
        }
    }

    /**
     * A kept track that fails to play (a parse error, a source error on a file read from the
     * phone) is marked Damaged and fetched again; playback skips to the next part at once,
     * never looping on it.
     */
    private boolean skipDamagedKept(MediaItem failed, PlaybackException error) {
        if (failed == null || failed.mediaId == null || failed.mediaId.isEmpty()) return false;
        int code = error.errorCode;
        boolean fileProblem = (code >= PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED
                && code <= PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED)
                || code == PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE
                || code == PlaybackException.ERROR_CODE_DECODING_FAILED;
        KeepStore store;
        try { store = KeepStore.get(this); } catch (RuntimeException broken) { return false; }
        if (!fileProblem || !store.isKept(failed.mediaId)) return false;
        store.markDamaged(failed.mediaId);
        widgetUpdates.post(() -> {
            if (current != DaylightMediaService.this || player.getCurrentMediaItem() != failed) return;
            if (player.hasNextMediaItem()) {
                player.seekToNextMediaItem();
                player.prepare();
                player.play();
            }
        });
        return true;
    }
}
