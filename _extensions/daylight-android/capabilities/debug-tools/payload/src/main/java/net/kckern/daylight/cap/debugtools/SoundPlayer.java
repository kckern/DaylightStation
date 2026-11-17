package net.kckern.daylight.cap.debugtools;

import android.media.AudioAttributes;
import android.media.MediaPlayer;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * POST /sound. One sound at a time; a new one replaces the old.
 *
 * play() runs on a request thread and waits there for the player to prepare. The
 * player's callbacks arrive on the main thread and take no lock, so the main thread
 * never waits on a request that is itself waiting for a callback.
 */
final class SoundPlayer implements DebugToolsCapability.Sound {
    private final AtomicReference<MediaPlayer> current = new AtomicReference<>();

    /** True once the player is prepared and started. The URL was checked by SoundPolicy before it got here. */
    @Override public synchronized boolean play(String url, final boolean loop, int stream) throws Exception {
        stop();
        final MediaPlayer p = new MediaPlayer();
        final CountDownLatch prepared = new CountDownLatch(1);
        final AtomicBoolean failed = new AtomicBoolean();
        try {
            p.setAudioAttributes(new AudioAttributes.Builder().setLegacyStreamType(stream).build());
            p.setLooping(loop);
            p.setOnPreparedListener(mp -> prepared.countDown());
            p.setOnErrorListener((mp, what, extra) -> { failed.set(true); prepared.countDown(); finished(mp); return true; });
            p.setOnCompletionListener(mp -> { if (!loop) finished(mp); });
            p.setDataSource(url);
            p.prepareAsync();
            if (!prepared.await(10, TimeUnit.SECONDS) || failed.get()) {
                discard(p);
                return false;
            }
            // In place before it starts, so a sound that ends at once still finds itself here.
            current.set(p);
            p.start();
            return true;
        } catch (Exception e) {
            current.compareAndSet(p, null);
            discard(p);
            throw e;
        }
    }

    @Override public void stop() {
        MediaPlayer p = current.getAndSet(null);
        if (p == null) return;
        try { p.stop(); } catch (Throwable ignored) { }
        discard(p);
    }

    /** Main thread: the sound ended or broke. */
    private void finished(MediaPlayer mp) {
        current.compareAndSet(mp, null);
        discard(mp);
    }

    private static void discard(MediaPlayer p) {
        try { p.release(); } catch (Throwable ignored) { }
    }
}
