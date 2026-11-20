package net.kckern.daylight.cap.quickinput.shell;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.Deque;

import static org.junit.Assert.*;

public class TextDraftWriterTest {
    @Rule public TemporaryFolder files = new TemporaryFolder();

    @Test public void latestEditFlushesInOrderBeforeSendAndCannotRecreateSentDraft() throws Exception {
        CaptureDraftStore store = new CaptureDraftStore(files.getRoot(), CaptureScope.key("https://home.example", "alice"));
        Deque<Runnable> work = new ArrayDeque<>();
        TextDraftWriter writer = new TextDraftWriter(store, work::addLast, CaptureDraftStore.nextId(), "journal", "Journal",
                failure -> { throw new AssertionError(failure); });
        writer.edit("Earlier");
        writer.edit("Latest");
        assertNull(store.get(writer.id));
        writer.complete(() -> {
            assertEquals("Latest", new String(Files.readAllBytes(store.get(writer.id).file.toPath()), StandardCharsets.UTF_8));
            assertTrue(store.send(writer.id));
        }, failure -> { if (failure != null) throw new AssertionError(failure); });
        writer.edit("Late callback");
        while (!work.isEmpty()) work.removeFirst().run();
        assertNull(store.get(writer.id));
    }
}
