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
    private TextDraft.Snapshot pending;
    private long revision;
    private boolean scheduled;
    private boolean sealed;

    TextDraftWriter(CaptureDraftStore store, Executor disk, String id, long revision, Consumer<IOException> writeFailed) {
        this.store = store;
        this.disk = disk;
        this.id = id;
        this.revision = revision;
        this.writeFailed = writeFailed;
    }

    synchronized void edit(String text) {
        if (sealed) return;
        revision = Math.max(System.currentTimeMillis(), revision + 1);
        pending = new TextDraft.Snapshot(text, revision);
        if (scheduled) return;
        scheduled = true;
        disk.execute(() -> {
            try { flush(); } catch (IOException e) { writeFailed.accept(e); }
        });
    }

    synchronized long revision() { return revision; }

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
            TextDraft.Snapshot snapshot;
            synchronized (this) {
                snapshot = pending;
                pending = null;
                if (snapshot == null) {
                    scheduled = false;
                    return;
                }
            }
            try {
                store.writeText(id, snapshot);
            } catch (IOException e) {
                synchronized (this) {
                    if (pending == null) pending = snapshot;
                    scheduled = false;
                }
                throw e;
            }
        }
    }
}
