package net.kckern.daylight.cap.caractions.shell;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.os.Build;

import net.kckern.daylight.cap.quickinput.shell.MemoFiles;
import net.kckern.daylight.cap.quickinput.shell.RecorderMachine;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;

/**
 * Encodes the car's PCM on the phone and writes it where the phone recorder writes
 * its memos, under the same names (MemoFiles): Ogg/Opus as one file, playable up to
 * where it stops if the process dies; or, where the phone has no Opus encoder or no
 * Ogg writer, AAC in MP4 as five-minute segments, each a whole file.
 *
 * One thread calls write() and finish(): the one that reads the car's microphone. A
 * write waits for the encoder, so a stalled encoder or disk holds the reader back
 * instead of growing a buffer; a write that cannot hand its sound to the encoder in
 * about two seconds fails, and the recording ends and is saved.
 */
final class CarMemoWriter {
    private static final String OPUS = "audio/opus";
    private static final int BIT_RATE = 32_000;
    private static final long DEQUEUE_US = 10_000;
    private static final int MAX_INPUT_WAITS = 200;

    private final File inbox;
    private final String memoId;
    private final String dest;
    private final RecorderMachine.Format format;
    private final long memoStartMs;
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

    private MediaCodec codec;
    private MediaMuxer muxer;
    private MediaFormat outFormat;
    private int track = -1;
    private boolean muxing;
    private File part;
    private int segment;
    private long segmentStartUs;
    private long segmentStartBytes;
    private long pcmBytes;
    private long encodedBytes;
    private boolean anyKept;

    CarMemoWriter(File inbox, String memoId, String dest, RecorderMachine.Format format, long memoStartMs) {
        this.inbox = inbox;
        this.memoId = memoId;
        this.dest = dest;
        this.format = format;
        this.memoStartMs = memoStartMs;
    }

    /** True where the phone has an Opus encoder for 16 kHz mono speech and MediaMuxer writes Ogg (Android 10 and later). */
    static boolean opusAvailable() {
        if (Build.VERSION.SDK_INT < 29) return false;
        try {
            MediaFormat f = MediaFormat.createAudioFormat(OPUS, CarMemo.SAMPLE_RATE, CarMemo.CHANNELS);
            f.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE);
            return new MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(f) != null;
        } catch (RuntimeException unknown) {
            return false;
        }
    }

    private boolean ogg() { return format == RecorderMachine.Format.OGG_OPUS; }

    long pcmBytes() { return pcmBytes; }

    long encodedBytes() { return encodedBytes; }

    void open() throws IOException {
        String mime = ogg() ? OPUS : MediaFormat.MIMETYPE_AUDIO_AAC;
        MediaFormat f = MediaFormat.createAudioFormat(mime, CarMemo.SAMPLE_RATE, CarMemo.CHANNELS);
        f.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE);
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024);
        if (!ogg()) f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        codec = MediaCodec.createEncoderByType(mime);
        codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        codec.start();
        openFile();
    }

    private void openFile() throws IOException {
        if (ogg()) {
            part = MemoFiles.part(inbox, MemoFiles.stem(memoId, dest), MemoFiles.OGG);
            // MUXER_OUTPUT_OGG is API 29; format() chose Ogg only there.
            muxer = Build.VERSION.SDK_INT >= 29 ? new MediaMuxer(part.getPath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG) : null;
            if (muxer == null) throw new IOException("no Ogg writer below Android 10");
        } else {
            part = MemoFiles.part(inbox, MemoFiles.stem(MemoFiles.segmentId(memoId, segment), dest), MemoFiles.M4A);
            muxer = new MediaMuxer(part.getPath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        }
        muxing = false;
        if (outFormat != null) {
            track = muxer.addTrack(outFormat);
            muxer.start();
            muxing = true;
        }
    }

    /** Hands len bytes of PCM to the encoder and writes what it has encoded. */
    void write(byte[] pcm, int len) throws IOException {
        int off = 0;
        int waits = 0;
        while (off < len) {
            int idx = codec.dequeueInputBuffer(DEQUEUE_US);
            if (idx < 0) {
                drain(false);
                if (++waits > MAX_INPUT_WAITS) throw new IOException("the encoder stalled");
                continue;
            }
            waits = 0;
            ByteBuffer in = codec.getInputBuffer(idx);
            if (in == null) throw new IOException("the encoder gave no buffer");
            in.clear();
            int n = Math.min(len - off, in.remaining());
            n -= n % 2;
            if (n <= 0) throw new IOException("the encoder's buffer is too small");
            in.put(pcm, off, n);
            codec.queueInputBuffer(idx, 0, n, CarMemo.ptsUs(pcmBytes), 0);
            pcmBytes += n;
            off += n;
            drain(false);
        }
    }

    private void drain(boolean endOfStream) throws IOException {
        int idle = 0;
        while (true) {
            int idx = codec.dequeueOutputBuffer(info, endOfStream ? DEQUEUE_US : 0);
            if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream || ++idle > MAX_INPUT_WAITS) return;
                continue;
            }
            if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                outFormat = codec.getOutputFormat();
                if (!muxing) {
                    track = muxer.addTrack(outFormat);
                    muxer.start();
                    muxing = true;
                }
                continue;
            }
            if (idx < 0) continue;
            ByteBuffer out = codec.getOutputBuffer(idx);
            boolean config = (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0;
            boolean last = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
            if (out != null && !config && info.size > 0 && muxing) {
                if (!ogg() && CarMemo.segmentDone(segmentStartUs, info.presentationTimeUs)) nextSegment(info.presentationTimeUs);
                long pts = info.presentationTimeUs;
                info.presentationTimeUs = ogg() ? pts : pts - segmentStartUs;
                muxer.writeSampleData(track, out, info);
                info.presentationTimeUs = pts;
                encodedBytes += info.size;
            }
            codec.releaseOutputBuffer(idx, false);
            if (last) return;
        }
    }

    /** An MP4 segment is whole: it is closed, named with its own start time, and a new one begun. */
    private void nextSegment(long ptsUs) throws IOException {
        boolean stopped = stopMuxer();
        long segmentMs = CarMemo.durationMs(pcmBytes - segmentStartBytes);
        if (RecorderMachine.keep(format, stopped, segmentMs, part.length())) {
            if (MemoFiles.finishSegment(part, memoStartMs + segmentStartUs / 1000) != null) anyKept = true;
        } else {
            part.delete();
        }
        segment++;
        segmentStartUs = ptsUs;
        segmentStartBytes = pcmBytes;
        openFile();
    }

    private boolean stopMuxer() {
        boolean stopped = false;
        try {
            if (muxing) {
                muxer.stop();
                stopped = true;
            }
        } catch (RuntimeException failed) {
            stopped = false;
        }
        try { muxer.release(); } catch (RuntimeException ignored) { }
        muxing = false;
        return stopped;
    }

    /**
     * Ends the recording: the encoder is flushed, the file closed and kept or discarded
     * by the phone recorder's rule (RecorderMachine.keep). True when any memo was kept.
     */
    boolean finish() {
        try {
            int idx = codec.dequeueInputBuffer(DEQUEUE_US * 20);
            if (idx >= 0) {
                codec.queueInputBuffer(idx, 0, 0, CarMemo.ptsUs(pcmBytes), MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                drain(true);
            }
        } catch (IOException | RuntimeException encoder) {
            // What was written stays; an Ogg file plays up to there.
        }
        try { codec.stop(); } catch (RuntimeException ignored) { }
        try { codec.release(); } catch (RuntimeException ignored) { }
        boolean stopped = stopMuxer();
        long durationMs = CarMemo.durationMs(pcmBytes - segmentStartBytes);
        if (part != null && RecorderMachine.keep(format, stopped, durationMs, part.length())) {
            File done = ogg() ? MemoFiles.finish(part) : MemoFiles.finishSegment(part, memoStartMs + segmentStartUs / 1000);
            if (done != null) anyKept = true;
        } else if (part != null) {
            part.delete();
        }
        return anyKept;
    }

    /** Could not begin: nothing is kept. */
    void abort() {
        try { if (codec != null) codec.release(); } catch (RuntimeException ignored) { }
        if (muxer != null) stopMuxer();
        if (part != null) part.delete();
    }
}
