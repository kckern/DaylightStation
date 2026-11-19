package net.kckern.daylight.cap.caractions.shell;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.car.app.CarContext;
import androidx.car.app.media.CarAudioRecord;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.cap.quickinput.shell.MemoFiles;
import net.kckern.daylight.cap.quickinput.shell.MemoRecovery;
import net.kckern.daylight.cap.quickinput.shell.RecorderMachine;

import java.io.File;
import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Records one voice memo through the car's microphone (CarAudioRecord, Car API level
 * 5) into the phone's quick-input inbox, for one destination. One recording at a time
 * in the process. Started only by RecordScreen.begin, which a tap calls.
 *
 * The car's sound arrives over Android Auto's connection, not from the phone's own
 * microphone. Nothing of it is logged: only its length and the outcome.
 */
final class CarRecorder {
    /** Told on the main thread. */
    interface Listener {
        void began();
        /** @param kept whether a memo was saved */
        void ended(boolean kept);
    }

    private static final AtomicBoolean BUSY = new AtomicBoolean();

    private final Context app;
    private final CarContext car;
    private final String dest;
    private final CarMemo memo;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile CarAudioRecord record;
    private volatile boolean stopping;

    CarRecorder(Context app, CarContext car, String dest, CarMemo memo, Listener listener) {
        this.app = app;
        this.car = car;
        this.dest = dest;
        this.memo = memo;
        this.listener = listener;
    }

    static boolean busy() { return BUSY.get(); }

    static boolean micGranted(Context context) {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    /** Begins on a thread of its own. False when another recording holds the car's microphone. */
    boolean start() {
        if (!BUSY.compareAndSet(false, true)) return false;
        Thread t = new Thread(this::run, "Daylight-car-memo");
        t.setDaemon(true);
        t.start();
        return true;
    }

    /** Ends the recording; the reading thread then saves it. Safe to call more than once. */
    void stop() {
        stopping = true;
        CarAudioRecord r = record;
        if (r != null) {
            try { r.stopRecording(); } catch (RuntimeException alreadyStopped) { }
        }
    }

    private void run() {
        CarMemoWriter writer = null;
        boolean kept = false;
        boolean began = false;
        try {
            if (!micGranted(app)) throw new IllegalStateException("no microphone permission");
            File inbox = new File(app.getFilesDir(), MemoFiles.INBOX);
            if (!inbox.isDirectory() && !inbox.mkdirs()) throw new IllegalStateException("no inbox");
            MemoRecovery.Found cutOff = MemoRecovery.recoverBeforeCar(app.getFilesDir());
            if (cutOff.recovered > 0) tellPayload();
            long startMs = System.currentTimeMillis();
            String memoId = MemoFiles.newId(startMs, new SecureRandom().nextLong());
            MemoRecovery.carLive(memoId);
            RecorderMachine.Format format = CarMemo.format(Build.VERSION.SDK_INT, CarMemoWriter.opusAvailable());
            writer = new CarMemoWriter(inbox, memoId, dest, format, startMs);
            writer.open();
            // Checked here again, where the car's microphone is opened.
            if (app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                throw new IllegalStateException("no microphone permission");
            }
            CarAudioRecord r;
            try {
                r = CarAudioRecord.create(car);
            } catch (SecurityException refused) {
                throw new IllegalStateException("the microphone was refused");
            }
            record = r;
            if (stopping) throw new IllegalStateException("stopped before it began");
            r.startRecording();
            began = true;
            memo.began(System.currentTimeMillis());
            main.post(listener::began);
            Log.i(DaylightCarAppService.TAG, "car memo began, " + format);
            byte[] buf = new byte[CarAudioRecord.AUDIO_CONTENT_BUFFER_SIZE * 8];
            while (!stopping) {
                int n;
                try {
                    n = r.read(buf, 0, buf.length);
                } catch (IllegalStateException closed) {
                    break;
                }
                if (n < 0) break;
                if (n == 0) continue;
                writer.write(buf, n);
                if (CarMemo.capReached(writer.pcmBytes(), writer.encodedBytes())) {
                    memo.ended(RecorderMachine.Event.CAP_REACHED, System.currentTimeMillis());
                    break;
                }
            }
        } catch (Throwable failed) {
            Log.w(DaylightCarAppService.TAG, "car memo " + (began ? "ended by an error: " : "could not begin: ") + failed.getClass().getSimpleName());
            if (began) memo.ended(RecorderMachine.Event.RECORDER_ERROR, System.currentTimeMillis());
            else memo.failedToBegin();
        } finally {
            CarAudioRecord r = record;
            record = null;
            if (r != null) {
                try { r.stopRecording(); } catch (RuntimeException alreadyStopped) { }
            }
            if (writer != null) {
                if (began) kept = writer.finish();
                else writer.abort();
            }
            MemoRecovery.carLive(null);
            BUSY.set(false);
            if (kept) tellPayload();
            long seconds = writer == null ? 0 : CarMemo.durationMs(writer.pcmBytes()) / 1000;
            Log.i(DaylightCarAppService.TAG, "car memo ended after " + seconds + " s, " + (kept ? "kept" : "not kept"));
            final boolean saved = kept;
            main.post(() -> listener.ended(saved));
        }
    }

    /** The quick-input capability queues the new file now; with no payload it finds it at its next scan. */
    private static void tellPayload() {
        try {
            PayloadPort.named(MemoFiles.PORT).call(MemoFiles.RECORDED, 0);
        } catch (Throwable notNow) {
            // Found at the next scan.
        }
    }
}
