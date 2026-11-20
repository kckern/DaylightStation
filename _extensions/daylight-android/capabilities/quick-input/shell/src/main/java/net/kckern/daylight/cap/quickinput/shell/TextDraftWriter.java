package net.kckern.daylight.cap.quickinput.shell;

import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/** Orders coalesced edits and a final handoff on a serial disk executor. */
final class TextDraftWriter {
    interface Action { void run() throws IOException; }

    final String id;
    private final CaptureDraftStore store;
    private final Executor disk;
    private final Consumer<IOException> writeFailed;
    private String pending;
    private boolean scheduled;
    private boolean sealed;

    TextDraftWriter(CaptureDraftStore store, Executor disk, String id, Consumer<IOException> writeFailed) {
        this.store = store;
        this.disk = disk;
        this.id = id;
        this.writeFailed = writeFailed;
    }

    synchronized void edit(String text) {
        if (sealed) return;
        pending = text;
        if (scheduled) return;
        scheduled = true;
        disk.execute(() -> {
            try { flush(); } catch (IOException e) { writeFailed.accept(e); }
        });
    }

    synchronized void complete(Action operation, Consumer<IOException> done) {
        if (sealed) return;
        sealed = true;
        disk.execute(() -> {
            IOException failure = null;
            try {
                flush();
                operation.run();
            } catch (IOException e) {
                failure = e;
                synchronized (this) { sealed = false; }
            }
            done.accept(failure);
        });
    }

    private void flush() throws IOException {
        while (true) {
            String text;
            synchronized (this) {
                text = pending;
                pending = null;
                if (text == null) {
                    scheduled = false;
                    return;
                }
            }
            try {
                store.writeText(id, text);
            } catch (IOException e) {
                synchronized (this) {
                    if (pending == null) pending = text;
                    scheduled = false;
                }
                throw e;
            }
        }
    }
}
