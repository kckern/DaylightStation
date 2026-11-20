package net.kckern.daylight.cap.quickinput.shell;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileTime;
import java.security.SecureRandom;
import java.util.Objects;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Private phone drafts and the only publisher of their files to the upload inbox. */
final class CaptureDraftStore {
    static final String CAMERA_DIR = "inputs/camera-private";
    private static final String DIRECTORY = "capture-drafts";
    private static final String OLD_VOICE_DIR = "phone-memo-drafts";
    private static final String DRAFT_ID = "[0-9]{10,16}-[0-9a-f]{8}(?:-[0-9]{2})?";
    private static final Pattern ANY_DRAFT_ID = Pattern.compile(DRAFT_ID);
    private static final Pattern OLD_VOICE_NAME = Pattern.compile("(" + DRAFT_ID
            + ")(?:\\.([a-z][a-z0-9-]{0,31}))?(?:@([0-9]{10,16}))?(\\.ogg|\\.m4a)(\\.part)?");
    private static final Object LOCK = new Object();

    enum Kind {
        TEXT(CaptureFiles.TEXT, CaptureFiles.INBOX),
        PHOTO(CaptureFiles.PHOTO, CaptureFiles.INBOX),
        OPUS(MemoFiles.OGG, MemoFiles.INBOX),
        AAC(MemoFiles.M4A, MemoFiles.INBOX);

        final String suffix;
        final String inbox;
        Kind(String suffix, String inbox) { this.suffix = suffix; this.inbox = inbox; }
        boolean voice() { return this == OPUS || this == AAC; }
    }

    static final class Draft {
        final String id;
        final String dest;
        final String label;
        final long timestamp;
        final Kind kind;
        final File file;
        final File directory;

        Draft(File directory, String dest, String label, Kind kind, String timestampOverride) {
            this.directory = directory;
            this.id = directory.getName();
            this.dest = dest;
            this.label = label;
            this.kind = kind;
            this.timestamp = Long.parseLong(timestampOverride == null
                    ? id.substring(0, id.indexOf('-')) : timestampOverride);
            this.file = new File(directory, MemoFiles.stem(id, dest)
                    + (timestampOverride == null ? "" : "@" + timestampOverride) + kind.suffix);
        }

        File fragment() { return new File(directory, file.getName() + ".part"); }
        File confirmedPhoto() { return new File(directory, "camera-confirmed"); }
        File cameraResult() { return new File(directory, "camera-result"); }
        File interruption() { return new File(directory, "interrupted"); }
        boolean hasContent() { return file.isFile() && file.length() > 0; }
        boolean requiresDiscardConfirmation() {
            return hasContent() || fragment().length() > 0 || interruption().isFile()
                    || confirmedPhoto().isFile() || cameraResult().isFile();
        }
    }

    interface MoveCheckpoint { void reached(boolean moved) throws IOException; }
    interface AudioCheck { boolean playable(File fragment); }

    private final File filesDir;
    private final File root;
    private final MoveCheckpoint checkpoint;
    private final MoveCheckpoint cameraCheckpoint;
    private final String owner;

    CaptureDraftStore(File filesDir) { this(filesDir, null, moved -> { }); }

    CaptureDraftStore(File filesDir, String owner) { this(filesDir, owner, moved -> { }); }

    CaptureDraftStore(File filesDir, String owner, MoveCheckpoint checkpoint) {
        this(filesDir, owner, checkpoint, moved -> { });
    }

    CaptureDraftStore(File filesDir, String owner, MoveCheckpoint checkpoint, MoveCheckpoint cameraCheckpoint) {
        if (owner != null && !CaptureScope.valid(owner)) throw new IllegalArgumentException("Invalid capture owner");
        this.owner = owner;
        this.filesDir = filesDir;
        this.root = new File(filesDir, DIRECTORY);
        this.checkpoint = checkpoint;
        this.cameraCheckpoint = cameraCheckpoint;
    }

    static String nextId() { return MemoFiles.newId(System.currentTimeMillis(), new SecureRandom().nextLong()); }

    Draft create(String dest, String label, Kind kind) throws IOException {
        return create(nextId(), dest, label, kind);
    }

    Draft create(String id, String dest, String label, Kind kind) throws IOException {
        return create(id, dest, label, kind, null);
    }

    private Draft create(String id, String dest, String label, Kind kind, String timestampOverride) throws IOException {
        synchronized (LOCK) {
            if (!validId(id) || (dest == null ? !kind.voice() : MemoFiles.dest(dest) == null)) {
                throw new IOException("Invalid draft identity");
            }
            ensureDirectory(root);
            File directory = new File(root, id);
            if (directory.exists()) throw new IOException("Draft already exists");
            File staging = Files.createTempDirectory(root.toPath(), "new-").toFile();
            File metadata = new File(staging, "metadata");
            try {
                Properties meta = new Properties();
                meta.setProperty("kind", kind.name());
                meta.setProperty("label", label);
                if (owner != null) meta.setProperty("owner", owner);
                if (dest != null) meta.setProperty("dest", dest);
                if (timestampOverride != null) meta.setProperty("time", timestampOverride);
                try (FileOutputStream output = new FileOutputStream(metadata)) {
                    meta.store(output, null);
                    output.getFD().sync();
                }
                syncDirectory(staging);
                move(staging, directory);
                syncDirectory(root);
            } finally {
                Files.deleteIfExists(metadata.toPath());
                Files.deleteIfExists(staging.toPath());
            }
            return new Draft(directory, dest, label, kind, timestampOverride);
        }
    }

    /** After a process interruption the source is authoritative even if the inbox has been drained. */
    Draft get(String id) throws IOException {
        synchronized (LOCK) {
            if (!validId(id)) return null;
            File directory = new File(root, id);
            File metadata = new File(directory, "metadata");
            if (!metadata.isFile()) return null;
            Properties meta = new Properties();
            try (FileInputStream input = new FileInputStream(metadata)) { meta.load(input); }
            if (!Objects.equals(owner, meta.getProperty("owner"))) return null;
            Kind kind = Kind.valueOf(meta.getProperty("kind"));
            Draft draft = new Draft(directory, MemoFiles.dest(meta.getProperty("dest")), meta.getProperty("label"), kind, meta.getProperty("time"));
            File intent = new File(directory, "send");
            if (intent.isFile()) {
                if (!draft.file.isFile()) {
                    removeDraft(draft);
                    return null;
                }
                Files.delete(intent.toPath());
                syncDirectory(directory);
            }
            return draft;
        }
    }

    Draft latest(String dest, Kind kind) throws IOException {
        synchronized (LOCK) {
            File[] entries = root.listFiles();
            if (entries == null) return null;
            Draft latest = null;
            for (File entry : entries) {
                Draft draft = get(entry.getName());
                if (draft == null || !(draft.kind == kind || kind.voice() && draft.kind.voice())
                        || !sameDestination(dest, draft.dest, kind.voice())
                        || !(draft.hasContent() || draft.interruption().isFile()
                                || draft.confirmedPhoto().isFile() || draft.cameraResult().isFile())) continue;
                if (latest == null || draft.timestamp > latest.timestamp) latest = draft;
            }
            return latest;
        }
    }

    /** Reconcile a saved Android editor state only when the private draft still exists. */
    TextDraft.Snapshot restoreText(String id, TextDraft.Snapshot saved) throws IOException {
        synchronized (LOCK) {
            Draft draft = get(id);
            if (draft == null || draft.kind != Kind.TEXT) return null;
            long revision = textRevision(draft);
            if (saved != null && saved.revision > revision) {
                writeText(draft, saved);
                return saved;
            }
            String text = draft.file.isFile()
                    ? new String(Files.readAllBytes(draft.file.toPath()), StandardCharsets.UTF_8) : "";
            return new TextDraft.Snapshot(text, revision);
        }
    }

    void writeText(String id, String text) throws IOException {
        synchronized (LOCK) {
            Draft draft = requireText(id);
            long revised = Math.max(System.currentTimeMillis(), textRevision(draft) + 1);
            writeText(draft, new TextDraft.Snapshot(text, revised));
        }
    }

    void writeText(String id, TextDraft.Snapshot snapshot) throws IOException {
        synchronized (LOCK) {
            Draft draft = requireText(id);
            if (snapshot.revision > textRevision(draft)) writeText(draft, snapshot);
        }
    }

    private Draft requireText(String id) throws IOException {
        Draft draft = get(id);
        if (draft == null || draft.kind != Kind.TEXT) throw new IOException("No text draft");
        return draft;
    }

    /** The file's modification time carries the revision through the same rename as its text. */
    private static long textRevision(Draft draft) throws IOException {
        return draft.file.isFile() ? Files.getLastModifiedTime(draft.file.toPath()).toMillis() : 0;
    }

    private static void writeText(Draft draft, TextDraft.Snapshot snapshot) throws IOException {
        File temp = new File(draft.directory, "text.tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(snapshot.body.getBytes(StandardCharsets.UTF_8));
            Files.setLastModifiedTime(temp.toPath(), FileTime.fromMillis(snapshot.revision));
            output.getFD().sync();
        }
        move(temp, draft.file);
        syncDirectory(draft.directory);
    }

    String pendingCameraName(Draft draft, String rawName) {
        if (draft == null || draft.kind != Kind.PHOTO || !draft.dest.equals(CaptureFiles.destOf(rawName))) return null;
        return cameraFile(rawName).isFile() ? rawName : null;
    }

    File cameraFile(String name) { return new File(new File(filesDir, CAMERA_DIR), name); }

    String confirmedCameraName(Draft draft) throws IOException {
        if (draft == null || draft.kind != Kind.PHOTO || !draft.cameraResult().isFile()) return null;
        String name = new String(Files.readAllBytes(draft.cameraResult().toPath()), StandardCharsets.UTF_8);
        if (!draft.dest.equals(CaptureFiles.destOf(name))) throw new IOException("Invalid camera result");
        return name;
    }

    boolean retainCameraResult(String id, String rawName, boolean cameraConfirmed) throws IOException {
        synchronized (LOCK) {
            Draft draft = get(id);
            if (draft == null || draft.kind != Kind.PHOTO || !draft.dest.equals(CaptureFiles.destOf(rawName))) return false;
            File raw = cameraFile(rawName);
            String recorded = confirmedCameraName(draft);
            if (recorded == null) {
                if (!PhotoPlan.captured(cameraConfirmed, raw.length())) {
                    Files.deleteIfExists(raw.toPath());
                    return false;
                }
                // Record the result before touching the camera file. The receipt stays
                // after failures on either side of the move, including after a restart.
                File pending = new File(draft.directory, "camera-result.tmp");
                try (FileOutputStream output = new FileOutputStream(pending)) {
                    output.write(rawName.getBytes(StandardCharsets.UTF_8));
                    output.getFD().sync();
                }
                move(pending, draft.cameraResult());
            } else if (!cameraConfirmed || !rawName.equals(recorded)) {
                return false;
            }
            syncDirectory(draft.directory);

            if (raw.isFile()) {
                cameraCheckpoint.reached(false);
                syncFile(raw);
                move(raw, draft.confirmedPhoto());
                cameraCheckpoint.reached(true);
            } else if (!draft.confirmedPhoto().isFile()) {
                throw new IOException("Confirmed camera output is missing");
            }
            syncDirectory(draft.directory);
            if (raw.getParentFile().isDirectory()) syncDirectory(raw.getParentFile());
            Files.delete(draft.cameraResult().toPath());
            // The confirmed output is durable. If a crash restores the receipt, retry
            // recognizes the already-moved source and removes the receipt again.
            return true;
        }
    }

    boolean acceptPhoto(String id, File candidate, boolean cameraConfirmed) throws IOException {
        synchronized (LOCK) {
            Draft draft = get(id);
            if (draft == null || draft.kind != Kind.PHOTO || draft.cameraResult().isFile()
                    || !PhotoPlan.captured(cameraConfirmed, candidate.length())) {
                Files.deleteIfExists(candidate.toPath());
                return false;
            }
            commitFile(candidate, draft.file);
            Files.deleteIfExists(draft.confirmedPhoto().toPath());
            syncDirectory(draft.directory);
            return true;
        }
    }

    boolean finishAudio(String id, AudioCheck check) throws IOException {
        synchronized (LOCK) {
            Draft draft = get(id);
            if (draft == null || !draft.kind.voice() || !draft.fragment().isFile()) return false;
            File fragment = draft.fragment();
            if (fragment.length() == 0) {
                Files.delete(fragment.toPath());
            } else if (check.playable(fragment)) {
                commitFile(fragment, draft.file);
                return true;
            } else {
                // Keep unreadable audio in the private draft directory under a separate name.
                commitFile(fragment, draft.interruption());
            }
            return false;
        }
    }

    void recoverAudio(String activeId, AudioCheck check) throws IOException {
        synchronized (LOCK) {
            if (owner == null) importLegacyAudio();
            File[] entries = root.listFiles();
            if (entries == null) return;
            for (File entry : entries) {
                if (!entry.getName().equals(activeId)) finishAudio(entry.getName(), check);
            }
        }
    }

    private void importLegacyAudio() throws IOException {
        File[] legacy = new File(filesDir, OLD_VOICE_DIR).listFiles();
        if (legacy == null) return;
        for (File original : legacy) {
            Matcher parsed = OLD_VOICE_NAME.matcher(original.getName());
            if (!original.isFile() || !parsed.matches()) continue;
            String id = parsed.group(1);
            String dest = parsed.group(2);
            Kind kind = MemoFiles.OGG.equals(parsed.group(4)) ? Kind.OPUS : Kind.AAC;
            Draft draft = get(id);
            if (draft == null) {
                String label = dest == null || "journal".equals(dest) ? "Journal" : dest;
                draft = create(id, dest, label, kind, parsed.group(3));
            }
            // The old directory was private. A complete file there had never reached
            // the inbox, and an unfinished file still needs the ordinary audio check.
            File target = parsed.group(5) == null ? draft.file : draft.fragment();
            if (!target.exists()) commitFile(original, target);
        }
    }

    static boolean sameDestination(String one, String other, boolean voice) {
        if (voice) {
            if (one == null) one = "journal";
            if (other == null) other = "journal";
        }
        return Objects.equals(one, other);
    }

    boolean discard(String id, boolean confirmed) throws IOException {
        synchronized (LOCK) {
            Draft draft = get(id);
            if (draft == null || !confirmed && draft.requiresDiscardConfirmation()) return false;
            removeDraft(draft);
            return true;
        }
    }

    boolean sendForCurrentOwner(String id) throws IOException {
        return CaptureScope.currentIs(owner) && send(id);
    }

    boolean send(String id) throws IOException {
        if (owner == null) return false;
        synchronized (LOCK) {
            Draft draft = get(id);
            if (draft == null || !draft.hasContent() || draft.confirmedPhoto().isFile() || draft.cameraResult().isFile()) return false;
            File inbox = CaptureScope.inbox(new File(filesDir, draft.kind.inbox), owner);
            ensureDirectory(inbox);
            File target = new File(inbox, draft.file.getName());
            if (target.exists()) throw new IOException("A queued input already uses this identity");
            File intent = new File(draft.directory, "send");
            syncFile(draft.file);
            try (FileOutputStream output = new FileOutputStream(intent)) {
                output.getFD().sync();
            }
            syncDirectory(draft.directory);
            checkpoint.reached(false);
            move(draft.file, target);
            syncDirectory(inbox);
            syncDirectory(draft.directory);
            checkpoint.reached(true);
            removeDraft(draft);
            return true;
        }
    }

    private static boolean validId(String id) { return id != null && ANY_DRAFT_ID.matcher(id).matches(); }

    private void removeDraft(Draft draft) throws IOException {
        String rawName = confirmedCameraName(draft);
        if (rawName != null) {
            File raw = cameraFile(rawName);
            if (Files.deleteIfExists(raw.toPath())) syncDirectory(raw.getParentFile());
        }
        // Remove metadata last, after content. During Send, keep the intent until the
        // metadata is gone so cleanup can never turn a submitted draft into an empty draft.
        File[] entries = draft.directory.listFiles();
        if (entries == null) throw new IOException("Cannot list draft");
        File metadata = new File(draft.directory, "metadata");
        File intent = new File(draft.directory, "send");
        for (File entry : entries) {
            if (!entry.equals(metadata) && !entry.equals(intent)) Files.deleteIfExists(entry.toPath());
        }
        Files.deleteIfExists(metadata.toPath());
        syncDirectory(draft.directory);
        Files.deleteIfExists(intent.toPath());
        Files.deleteIfExists(draft.directory.toPath());
        syncDirectory(draft.directory.getParentFile());
    }

    private static void commitFile(File from, File to) throws IOException {
        syncFile(from);
        move(from, to);
        syncDirectory(to.getParentFile());
        if (!from.getParentFile().equals(to.getParentFile())) syncDirectory(from.getParentFile());
    }

    private static void move(File from, File to) throws IOException {
        Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    private static void syncFile(File file) throws IOException {
        try (RandomAccessFile handle = new RandomAccessFile(file, "rw")) { handle.getFD().sync(); }
    }

    private static void ensureDirectory(File dir) throws IOException {
        if (dir.isDirectory()) return;
        ensureDirectory(dir.getParentFile());
        if (!dir.mkdir() && !dir.isDirectory()) throw new IOException("Could not create draft storage");
        syncDirectory(dir.getParentFile());
    }

    private static void syncDirectory(File directory) throws IOException {
        try (FileChannel channel = FileChannel.open(directory.toPath(), StandardOpenOption.READ)) { channel.force(true); }
    }
}
