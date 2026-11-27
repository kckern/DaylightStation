package net.kckern.daylight.cap.caractions.shell;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import net.kckern.daylight.api.PayloadPort;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The car list: a ListTemplate of the payload's car entries, tap targets only. A tap
 * runs the entry off the main thread through the payload and shows its message as a
 * car toast; a tap on a voice entry starts a recording and opens the car's recording
 * screen (RecordScreen). Drawing the screen, a refresh and the car connecting run nothing: only a
 * row's own click does.
 *
 * Cold start: with no payload yet, the list is one row, "Daylight is starting", and
 * the screen redraws once a payload attaches (the media service's pattern).
 */
final class ActionsScreen extends Screen {
    private static final long LIST_WAIT_MS = 4000;
    private static final long RUN_WAIT_MS = 8000;
    private static final long STARTING_WAIT_MS = 120_000;
    /** A running action takes taps again after this, even with no answer. */
    private static final long RUN_DEADLINE_MS = RUN_WAIT_MS + 4000;

    private final DaylightCarAppService service;
    private final PayloadCar payload = new PayloadCar();
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-car-io");
        t.setDaemon(true);
        return t;
    });
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean loading = new AtomicBoolean();
    private final AtomicBoolean waiting = new AtomicBoolean();
    /** Null until the first answer. Touched on the main thread only. */
    private List<CarAnswers.Entry> rows;
    /** Actions whose answer has not come back. Touched on the main thread only. */
    private final RunGuard runs = new RunGuard(RUN_DEADLINE_MS);

    ActionsScreen(CarContext carContext, DaylightCarAppService service) {
        super(carContext);
        this.service = service;
        getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override public void onDestroy(@NonNull LifecycleOwner owner) { io.shutdownNow(); }
        });
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        if (!service.servesHost()) {
            return new MessageTemplate.Builder("Daylight is not available on this car connection")
                    .setTitle("Daylight").setHeaderAction(Action.APP_ICON).build();
        }
        ListTemplate.Builder template = new ListTemplate.Builder().setTitle("Daylight").setHeaderAction(Action.APP_ICON);
        List<CarAnswers.Entry> current = rows;
        if (current == null) {
            load();
            return template.setLoading(true).build();
        }
        ItemList.Builder items = new ItemList.Builder().setNoItemsMessage("No actions are set for the car");
        for (final CarAnswers.Entry e : current) {
            Row.Builder row = new Row.Builder().setTitle(e.label);
            if (CarAnswers.RUN.equals(e.kind) && runs.running(e.id, SystemClock.uptimeMillis())) {
                row.addText(RunGuard.SENDING + "…");
            }
            if (CarAnswers.RUN.equals(e.kind)) row.setOnClickListener(() -> run(e));
            if (CarAnswers.VOICE.equals(e.kind)) row.setOnClickListener(() -> record(e));
            items.addItem(row.build());
        }
        return template.setSingleList(items.build()).build();
    }

    /** Asks the payload for the list off the main thread, then redraws. Starts nothing. */
    private void load() {
        if (!loading.compareAndSet(false, true)) return;
        try {
            io.execute(() -> {
                List<CarAnswers.Entry> answer;
                boolean failedList = false;
                try {
                    answer = CarAnswers.entries(payload.list(LIST_WAIT_MS));
                } catch (PayloadPort.NotReadyException noPayload) {
                    answer = CarAnswers.starting();
                    redrawWhenReady();
                } catch (Throwable broke) {
                    // The payload is replaceable code; whatever it throws must not take the screen down.
                    Log.w(DaylightCarAppService.TAG, "car list failed: " + broke.getClass().getSimpleName());
                    answer = CarAnswers.starting();
                    failedList = true;
                }
                final List<CarAnswers.Entry> shown = answer;
                final boolean retrySoon = failedList;
                main.post(() -> {
                    rows = shown;
                    loading.set(false);
                    invalidate();
                    // A list that threw must not leave the car on "starting" for good: ask again shortly.
                    if (retrySoon) main.postDelayed(() -> { rows = null; invalidate(); }, 5000);
                });
            });
        } catch (RuntimeException stopping) {
            loading.set(false);
        }
    }

    /** One waiter: when a payload attaches, the list is asked for again. */
    private void redrawWhenReady() {
        if (!waiting.compareAndSet(false, true)) return;
        Thread waiter = new Thread(() -> {
            try {
                if (payload.awaitReady(STARTING_WAIT_MS)) {
                    main.post(() -> {
                        rows = null;
                        invalidate();
                    });
                }
            } finally {
                waiting.set(false);
            }
        }, "Daylight-car-wait");
        waiter.setDaemon(true);
        waiter.start();
    }

    /**
     * A voice entry's click: the one place a car recording starts. It is refused, with
     * the reason as a car toast, when the car is older than Car API level 5, the phone
     * has not been given the microphone, the payload says the entry cannot record, or a
     * recording is already under way.
     */
    private void record(final CarAnswers.Entry e) {
        if (!service.servesHost()) return;
        String why = e.dest == null ? "This entry has no destination" : e.why;
        String refused = CarMemo.refusal(getCarContext().getCarAppApiLevel(), CarRecorder.micGranted(getCarContext()), why,
                CarRecorder.busy());
        if (refused != null) {
            CarToast.makeText(getCarContext(), refused, CarToast.LENGTH_LONG).show();
            return;
        }
        RecordScreen screen = new RecordScreen(getCarContext(), service, e.label, e.dest);
        if (!screen.begin()) {
            CarToast.makeText(getCarContext(), CarMemo.BUSY, CarToast.LENGTH_LONG).show();
            return;
        }
        getScreenManager().push(screen);
    }

    /**
     * A row's click: the one place an action runs from the car. "Sending <label>…" shows
     * at once and the row reads "Sending…" until the answer; a tap on a running action
     * is ignored, so a second tap does not run a door or the lights twice.
     */
    private void run(final CarAnswers.Entry e) {
        if (!service.servesHost()) return;
        if (!runs.tryStart(e.id, SystemClock.uptimeMillis())) return;
        toast(RunGuard.sending(e.label));
        invalidate();
        // The row takes taps again at the deadline even if the answer never comes.
        main.postDelayed(this::redraw, RUN_DEADLINE_MS);
        try {
            io.execute(() -> {
                String message;
                try {
                    message = CarAnswers.message(payload.run(e.id, RUN_WAIT_MS));
                } catch (PayloadPort.NotReadyException noPayload) {
                    message = CarAnswers.STARTING;
                } catch (Throwable broke) {
                    Log.w(DaylightCarAppService.TAG, "car action failed: " + broke.getClass().getSimpleName());
                    message = CarAnswers.NO_ANSWER;
                }
                final String shown = message;
                main.post(() -> {
                    runs.finish(e.id);
                    toast(shown);
                    redraw();
                });
            });
        } catch (RuntimeException stopping) {
            // The screen is gone.
            runs.finish(e.id);
        }
    }

    private void redraw() {
        if (!getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.CREATED)) return;
        try {
            invalidate();
        } catch (RuntimeException gone) {
            // The car disconnected while the action ran.
        }
    }

    private void toast(String text) {
        try {
            CarToast.makeText(getCarContext(), text, CarToast.LENGTH_LONG).show();
        } catch (RuntimeException gone) {
            // The car disconnected.
        }
    }
}
