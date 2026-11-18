package net.kckern.daylight.cap.caractions.shell;

import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Template;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import net.kckern.daylight.cap.quickinput.shell.RecorderMachine;

/**
 * The car's own recording screen: a MessageTemplate with a running clock and one Stop
 * action. Tap targets only, no text entry, so it stays usable while driving.
 *
 * The recording is started by begin(), which the list calls from a tap on the entry
 * and nowhere else. Drawing this screen, redrawing it and the car reconnecting start
 * nothing (CarMemo). Stop, the thirty-minute cap, an error, or the screen going away
 * (the driver backs out, the car disconnects) ends the recording and saves it.
 */
final class RecordScreen extends Screen implements CarRecorder.Listener {
    private final DaylightCarAppService service;
    private final String label;
    private final CarMemo memo = new CarMemo();
    private final CarRecorder recorder;
    private final Handler main = new Handler(Looper.getMainLooper());
    private long beganAtMs;
    private boolean over;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (over || beganAtMs == 0) return;
            invalidate();
            main.postDelayed(this, 1000);
        }
    };

    RecordScreen(CarContext carContext, DaylightCarAppService service, String label, String dest) {
        super(carContext);
        this.service = service;
        this.label = label;
        this.recorder = new CarRecorder(service.getApplicationContext(), carContext, dest, memo, this);
        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override public void onDestroy(@NonNull LifecycleOwner owner) {
                main.removeCallbacks(tick);
                // Backing out or a disconnect ends the recording, and what was recorded is saved.
                memo.on(CarMemo.Screen.GONE, System.currentTimeMillis());
                if (!over) recorder.stop();
            }
        });
    }

    /** The tap on the list entry. The one way a recording starts. False when it could not. */
    boolean begin() {
        if (memo.on(CarMemo.Screen.TAP_ENTRY, System.currentTimeMillis()) != RecorderMachine.Action.BEGIN) return false;
        if (!recorder.start()) {
            memo.failedToBegin();
            return false;
        }
        return true;
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        // A redraw is never a start.
        memo.on(CarMemo.Screen.REFRESHED, System.currentTimeMillis());
        String text = over ? "Done" : beganAtMs == 0 ? "Starting" : CarMemo.clock(System.currentTimeMillis() - beganAtMs);
        MessageTemplate.Builder t = new MessageTemplate.Builder(text).setTitle(label).setHeaderAction(Action.BACK);
        if (!over && service.servesHost()) {
            t.addAction(new Action.Builder().setTitle("Stop").setOnClickListener(this::stopTapped).build());
        }
        return t.build();
    }

    private void stopTapped() {
        memo.on(CarMemo.Screen.TAP_STOP, System.currentTimeMillis());
        if (!over) recorder.stop();
    }

    @Override public void began() {
        if (over) return;
        beganAtMs = System.currentTimeMillis();
        invalidate();
        main.postDelayed(tick, 1000);
    }

    @Override public void ended(boolean kept) {
        over = true;
        main.removeCallbacks(tick);
        try {
            CarToast.makeText(getCarContext(), CarMemo.outcome(kept, label), CarToast.LENGTH_LONG).show();
        } catch (RuntimeException gone) {
            // The car disconnected; the memo is saved or not all the same.
        }
        try {
            finish();
        } catch (RuntimeException gone) {
            // Already off the stack.
        }
    }
}
