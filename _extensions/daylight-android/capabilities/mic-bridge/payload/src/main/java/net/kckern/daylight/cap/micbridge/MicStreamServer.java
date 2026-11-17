package net.kckern.daylight.cap.micbridge;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.util.Log;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import org.java_websocket.exceptions.WebsocketNotConnectedException;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * The microphone stream: 48 kHz mono s16le PCM frames over a WebSocket, one client at
 * a time, capture running only while that client is connected. In audio-bridge this
 * was an Android Service around the same inner server; the service, its notification
 * and its Bluetooth half are gone (the shell owns the service, bluetooth-controls the
 * Bluetooth), and the socket binds to loopback only.
 */
final class MicStreamServer {

    private static final String TAG = "AudioBridge";

    private static final int SAMPLE_RATE = 48000;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    // 10ms of audio at 48kHz mono 16-bit = 960 bytes
    private static final int FRAME_SIZE = SAMPLE_RATE / 100 * 2;

    // Retry config for AudioRecord initialization
    private static final int INIT_MAX_RETRIES = 3;
    private static final int[] INIT_RETRY_DELAYS_MS = {500, 1000, 2000};

    /** How long start() waits to learn whether the socket bound. */
    private static final long BIND_WAIT_MS = 2000;

    private final Context ctx;
    private AudioBridgeServer wsServer;
    private volatile int port;
    private volatile String lastError;
    /** True while the last attempt to open or start AudioRecord failed with the permission granted. */
    private volatile boolean captureDenied;

    MicStreamServer(Context ctx) { this.ctx = ctx; }

    /**
     * Binds to loopback: the page that consumes the stream runs on this device, and the
     * socket has no authentication. Returns once the socket is listening or has failed
     * to bind (see running() and lastError()).
     */
    synchronized void start(int port) {
        if (wsServer != null) return;
        this.port = port;
        wsServer = new AudioBridgeServer(new InetSocketAddress(InetAddress.getLoopbackAddress(), port));
        wsServer.start();
        try {
            if (!wsServer.settled.await(BIND_WAIT_MS, TimeUnit.MILLISECONDS)) lastError = "the stream socket did not start within " + BIND_WAIT_MS + "ms";
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        if (wsServer.listening) Log.i(TAG, "WebSocket server started on port " + port);
    }

    synchronized void stop() {
        if (wsServer == null) return;
        try { wsServer.stop(); } catch (InterruptedException e) { Log.w(TAG, "Interrupted while stopping WebSocket server", e); }
        // A client that was cut off by stop() may not get its close callback: release the microphone here.
        wsServer.stopCapture();
        wsServer = null;
    }

    /** Listening for a client. */
    synchronized boolean running() { return wsServer != null && wsServer.listening; }
    int port() { return port; }
    synchronized InetSocketAddress boundAddress() { return wsServer == null ? null : wsServer.getAddress(); }
    String lastError() { return lastError; }
    boolean captureDenied() { return captureDenied; }
    /** Frames are being read from the microphone and sent to a client. */
    boolean streaming() { AudioBridgeServer s = wsServer; return s != null && s.delivering; }
    int clients() { AudioBridgeServer s = wsServer; return s == null ? 0 : s.getConnections().size(); }

    /**
     * WebSocket server that manages audio capture per client connection.
     * Only one client is served at a time — the first connected client
     * gets the audio stream; additional connections are rejected.
     */
    private class AudioBridgeServer extends WebSocketServer {

        private volatile WebSocket activeClient = null;
        private volatile AudioRecord audioRecord = null;
        private volatile Thread captureThread = null;
        private volatile boolean capturing = false;
        /** True from a confirmed start of recording until the capture loop ends. */
        private volatile boolean delivering = false;
        /** True once the socket is bound and accepting. */
        private volatile boolean listening = false;
        /** Released when the socket has bound or failed to. */
        private final CountDownLatch settled = new CountDownLatch(1);

        public AudioBridgeServer(InetSocketAddress address) {
            super(address);
            setReuseAddr(true);
        }

        @Override
        public void onOpen(WebSocket conn, ClientHandshake handshake) {
            Log.i(TAG, "Client connected: " + conn.getRemoteSocketAddress());

            if (activeClient != null) {
                Log.w(TAG, "Rejecting client — another client already connected");
                conn.send("{\"error\":\"Another client is already connected\"}");
                conn.close(1008, "Another client is already connected");
                return;
            }

            activeClient = conn;

            // Send format header
            String header = String.format(
                    "{\"sampleRate\":%d,\"channels\":1,\"format\":\"pcm_s16le\"}",
                    SAMPLE_RATE
            );
            conn.send(header);
            Log.i(TAG, "Sent format header: " + header);

            // Start audio capture
            startCapture(conn);
        }

        @Override
        public void onClose(WebSocket conn, int code, String reason, boolean remote) {
            Log.i(TAG, "Client disconnected: code=" + code + " reason=" + reason);
            if (conn == activeClient) {
                stopCapture();
                activeClient = null;
            }
        }

        @Override
        public void onMessage(WebSocket conn, String message) {
            // No client-to-server messages expected
            Log.d(TAG, "Received text message (ignored): " + message);
        }

        @Override
        public void onError(WebSocket conn, Exception ex) {
            Log.e(TAG, "WebSocket error", ex);
            if (conn == null) {
                // A server-level failure, a bind that was refused for one.
                listening = false;
                lastError = "stream socket: " + ex;
                settled.countDown();
            }
            if (conn != null && conn == activeClient) {
                stopCapture();
                activeClient = null;
            }
        }

        @Override
        public void onStart() {
            listening = true;
            settled.countDown();
            Log.i(TAG, "WebSocket server listening on port " + port);
        }

        private void startCapture(WebSocket client) {
            int minBufSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
            int bufferSize = Math.max(minBufSize, FRAME_SIZE * 4);

            // Retry loop: AudioRecord init may fail if FKB services are still releasing MIC
            for (int attempt = 0; attempt <= INIT_MAX_RETRIES; attempt++) {
                if (attempt > 0) {
                    int delayMs = INIT_RETRY_DELAYS_MS[Math.min(attempt - 1, INIT_RETRY_DELAYS_MS.length - 1)];
                    Log.i(TAG, "AudioRecord init retry " + attempt + "/" + INIT_MAX_RETRIES + " after " + delayMs + "ms");
                    try {
                        Thread.sleep(delayMs);
                    } catch (InterruptedException e) {
                        Log.w(TAG, "Retry sleep interrupted");
                        Thread.currentThread().interrupt();
                        break;
                    }
                    if (!client.isOpen()) {
                        Log.i(TAG, "Client disconnected during retry wait");
                        activeClient = null;
                        return;
                    }
                }

                try {
                    // MIC source for USB mic on Shield TV (no telephony subsystem,
                    // so VOICE_COMMUNICATION fails to initialize). AEC/NS are applied
                    // explicitly after init via AcousticEchoCanceler/NoiseSuppressor.
                    audioRecord = new AudioRecord(
                            MediaRecorder.AudioSource.MIC,
                            SAMPLE_RATE,
                            CHANNEL_CONFIG,
                            AUDIO_FORMAT,
                            bufferSize
                    );
                } catch (SecurityException e) {
                    Log.e(TAG, "RECORD_AUDIO permission not granted", e);
                    // A missing grant, not another holder: captureDenied stays as it was.
                    lastError = "RECORD_AUDIO permission not granted";
                    client.send("{\"error\":\"RECORD_AUDIO permission not granted\"}");
                    client.close(1011, "Permission denied");
                    activeClient = null;
                    return;
                }

                if (audioRecord.getState() == AudioRecord.STATE_INITIALIZED) {
                    Log.i(TAG, "AudioRecord initialized on attempt " + (attempt + 1)
                            + " source=MIC");
                    break; // success
                }

                // Not initialized — clean up and retry
                Log.w(TAG, "AudioRecord init failed on attempt " + (attempt + 1) + "/" + (INIT_MAX_RETRIES + 1));
                audioRecord.release();
                audioRecord = null;

                if (attempt == INIT_MAX_RETRIES) {
                    Log.e(TAG, "AudioRecord failed to initialize after all retries");
                    lastError = "AudioRecord failed to initialize";
                    captureDenied = true;
                    client.send("{\"error\":\"AudioRecord failed to initialize\"}");
                    client.close(1011, "AudioRecord init failed");
                    activeClient = null;
                    return;
                }
            }

            if (audioRecord == null) {
                Log.e(TAG, "audioRecord is null after retry loop");
                lastError = "AudioRecord init failed";
                captureDenied = true;
                client.close(1011, "AudioRecord init failed");
                activeClient = null;
                return;
            }

            // Enable echo cancellation and noise suppression if hardware supports it.
            // Belt-and-suspenders with VOICE_COMMUNICATION source which also applies AEC.
            int sessionId = audioRecord.getAudioSessionId();
            if (AcousticEchoCanceler.isAvailable()) {
                AcousticEchoCanceler aec = AcousticEchoCanceler.create(sessionId);
                if (aec != null) {
                    aec.setEnabled(true);
                    Log.i(TAG, "AcousticEchoCanceler enabled");
                }
            } else {
                Log.i(TAG, "AcousticEchoCanceler not available on this device");
            }
            if (NoiseSuppressor.isAvailable()) {
                NoiseSuppressor ns = NoiseSuppressor.create(sessionId);
                if (ns != null) {
                    ns.setEnabled(true);
                    Log.i(TAG, "NoiseSuppressor enabled");
                }
            } else {
                Log.i(TAG, "NoiseSuppressor not available on this device");
            }

            capturing = true;
            audioRecord.startRecording();
            if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                captureDenied = false;
                lastError = null;
                delivering = true;
            } else {
                // The permission is granted and the record initialized, yet it will not record.
                Log.e(TAG, "AudioRecord did not start recording");
                lastError = "AudioRecord did not start recording";
                captureDenied = true;
            }
            Log.i(TAG, "AudioRecord started: source=MIC rate=" + SAMPLE_RATE
                    + " bufferSize=" + bufferSize + " minBufSize=" + minBufSize
                    + " sessionId=" + sessionId);

            captureThread = new Thread(() -> {
                byte[] buffer = new byte[FRAME_SIZE];
                long frameCount = 0;

                while (capturing && client.isOpen()) {
                    int bytesRead = audioRecord.read(buffer, 0, FRAME_SIZE);
                    if (bytesRead > 0) {
                        try {
                            client.send(ByteBuffer.wrap(buffer, 0, bytesRead));
                        } catch (WebsocketNotConnectedException e) {
                            Log.i(TAG, "Client disconnected during send");
                            break;
                        }
                        frameCount++;
                        if (frameCount % 1000 == 0) {
                            Log.d(TAG, "Sent " + frameCount + " frames ("
                                    + (frameCount * 10) + "ms)");
                        }
                    } else if (bytesRead < 0) {
                        Log.e(TAG, "AudioRecord.read error: " + bytesRead);
                        break;
                    }
                }

                delivering = false;
                Log.i(TAG, "Capture loop ended after " + frameCount + " frames");
            }, "AudioBridge-Capture");
            captureThread.setPriority(Thread.MAX_PRIORITY);
            captureThread.start();
        }

        private synchronized void stopCapture() {
            capturing = false;
            delivering = false;

            if (captureThread != null) {
                try {
                    captureThread.join(1000);
                } catch (InterruptedException e) {
                    Log.w(TAG, "Interrupted waiting for capture thread");
                }
                captureThread = null;
            }

            if (audioRecord != null) {
                try {
                    audioRecord.stop();
                } catch (IllegalStateException e) {
                    Log.w(TAG, "AudioRecord.stop() failed", e);
                }
                audioRecord.release();
                audioRecord = null;
                Log.i(TAG, "AudioRecord released");
            }
        }
    }
}
