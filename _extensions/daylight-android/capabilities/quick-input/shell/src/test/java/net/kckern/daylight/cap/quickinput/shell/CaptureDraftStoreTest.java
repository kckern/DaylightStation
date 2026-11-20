package net.kckern.daylight.cap.quickinput.shell;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.*;

public class CaptureDraftStoreTest {
    @Rule public TemporaryFolder files = new TemporaryFolder();
    private static final String FIRST = "1795110000000-12345678";
    private static final String SECOND = "1795110010000-abcdef12";

    @Test public void reopenedDraftKeepsItsDestinationAndBodyUntilConfirmedDiscard() throws Exception {
        CaptureDraftStore store = store();
        text(store, FIRST, "journal", "A note");
        store = store();
        CaptureDraftStore.Draft draft = store.get(FIRST);
        assertEquals("journal", draft.dest);
        assertEquals("Journal", draft.label);
        assertEquals(1795110000000L, draft.timestamp);
        assertEquals("A note", read(draft.file));
        assertTrue(draft.requiresDiscardConfirmation());
        assertFalse(store.discard(FIRST, false));
        assertEquals("A note", read(store.get(FIRST).file));
        assertTrue(store.discard(FIRST, true));
        assertNull(store.get(FIRST));
        assertInbox();
    }

    @Test public void interruptionBeforePublishLeavesDraftAndOtherShortcutIntact() throws Exception {
        CaptureDraftStore store = interrupted(false);
        assertEquals("A note", read(store.get(FIRST).file));
        assertEquals("Breakfast", read(store.get(SECOND).file));
        assertInbox();
        assertTrue(store.send(FIRST));
        assertFalse(store.send(FIRST));
        assertInbox(FIRST + ".journal.txt");
        assertEquals("Breakfast", read(store.get(SECOND).file));
    }

    @Test public void interruptionAfterPublishNeverRecreatesConsumedFile() throws Exception {
        CaptureDraftStore store = interrupted(true);
        assertInbox(FIRST + ".journal.txt");
        assertTrue(new File(files.getRoot(), "inputs/inbox/" + FIRST + ".journal.txt").delete());
        assertNull(store.get(FIRST));
        assertFalse(store.send(FIRST));
        assertInbox();
        assertEquals("Breakfast", read(store.get(SECOND).file));
    }

    @Test public void cameraCancellationAndRetakeKeepPriorPhotoPrivate() throws Exception {
        CaptureDraftStore store = store();
        CaptureDraftStore.Draft photo = store.create(FIRST, "journal", "Journal", CaptureDraftStore.Kind.PHOTO);
        File candidate = new File(files.getRoot(), "camera-output");
        Files.write(candidate.toPath(), new byte[] { 1 });
        assertFalse(store.acceptPhoto(photo.id, candidate, false));
        assertFalse(store.get(FIRST).hasContent());
        Files.write(candidate.toPath(), new byte[] { 2 });
        assertTrue(store.acceptPhoto(photo.id, candidate, true));
        Files.write(candidate.toPath(), new byte[] { 3 });
        assertFalse(store.acceptPhoto(photo.id, candidate, false));
        assertArrayEquals(new byte[] { 2 }, Files.readAllBytes(store.get(FIRST).file.toPath()));
        assertInbox();
        assertTrue(store.send(FIRST));
        assertFalse(store.send(FIRST));
        assertInbox(FIRST + ".journal.jpg");
    }

    @Test public void audioRecoveryLeavesActiveAudioAloneAndSeparatesUnreadableFragments() throws Exception {
        CaptureDraftStore store = store();
        CaptureDraftStore.Draft playable = store.create(FIRST, "journal", "Journal", CaptureDraftStore.Kind.OPUS);
        CaptureDraftStore.Draft interrupted = store.create(SECOND, "meal", "Meal", CaptureDraftStore.Kind.AAC);
        Files.write(playable.fragment().toPath(), new byte[] { 1 });
        Files.write(interrupted.fragment().toPath(), new byte[] { 2 });
        store = store();
        store.recoverAudio(FIRST, file -> false);
        assertTrue(playable.fragment().isFile());
        assertFalse(store.get(SECOND).hasContent());
        assertArrayEquals(new byte[] { 2 }, Files.readAllBytes(store.get(SECOND).interruption().toPath()));

        store.recoverAudio(null, file -> true);
        assertTrue(store.get(FIRST).hasContent());
        assertFalse(playable.fragment().isFile());
        assertNull(new File(files.getRoot(), "memos/inbox").list());
    }

    @Test public void recoveredLegacyPhoneMemoKeepsOriginalFilenameAndNeverAutoQueues() throws Exception {
        File legacy = files.newFolder("phone-memo-drafts");
        String name = FIRST + "-00.meal@1795110002000.m4a";
        Files.write(new File(legacy, name).toPath(), new byte[] { 1 });
        CaptureDraftStore store = store();
        store.recoverAudio(null, file -> true);
        CaptureDraftStore.Draft draft = store.latest("meal", CaptureDraftStore.Kind.OPUS);
        assertNotNull(draft);
        assertEquals(FIRST + "-00", draft.id);
        assertEquals(1795110002000L, draft.timestamp);
        assertNull(new File(files.getRoot(), "memos/inbox").list());
        assertTrue(store.send(draft.id));
        assertTrue(new File(files.getRoot(), "memos/inbox/" + name).isFile());
    }

    private CaptureDraftStore interrupted(boolean afterMove) throws Exception {
        CaptureDraftStore store = new CaptureDraftStore(files.getRoot(), moved -> {
            if (moved == afterMove) throw new IOException("simulated process interruption");
        });
        text(store, FIRST, "journal", "A note");
        text(store, SECOND, "meal", "Breakfast");
        assertThrows(IOException.class, () -> store.send(FIRST));
        return store();
    }

    private CaptureDraftStore store() { return new CaptureDraftStore(files.getRoot()); }

    private static void text(CaptureDraftStore store, String id, String dest, String body) throws Exception {
        store.create(id, dest, "Journal", CaptureDraftStore.Kind.TEXT);
        store.writeText(id, body);
    }

    private void assertInbox(String... expected) {
        String[] entries = new File(files.getRoot(), "inputs/inbox").list();
        assertArrayEquals(expected, entries == null ? new String[0] : entries);
    }

    private static String read(File file) throws IOException {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }
}
