package net.kckern.audiobridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.IBinder;
import android.util.Log;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import org.java_websocket.exceptions.WebsocketNotConnectedException;

import java.net.InetSocketAddress;
import java.nio.ByteBuffer;

public class AudioBridgeService extends Service {

    private static final String TAG = "AudioBridge";
    private static final String CHANNEL_ID = "audio_bridge_channel";
    private static final int NOTIFICATION_ID = 1;
    private static final int WS_PORT = 8765;

    private static final int SAMPLE_RATE = 48000;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    // 10ms of audio at 48kHz mono 16-bit = 960 bytes
    private static final int FRAME_SIZE = SAMPLE_RATE / 100 * 2;

    private AudioBridgeServer wsServer;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "Service created");
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "Service starting");

        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Audio Bridge")
                .setContentText("Streaming microphone audio")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .build();

        startForeground(NOTIFICATION_ID, notification);

        if (wsServer == null) {
            wsServer = new AudioBridgeServer(new InetSocketAddress(WS_PORT));
            wsServer.start();
            Log.i(TAG, "WebSocket server started on port " + WS_PORT);
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Service destroying");
        if (wsServer != null) {
            try {
                wsServer.stop();
            } catch (InterruptedException e) {
                Log.w(TAG, "Interrupted while stopping WebSocket server", e);
            }
            wsServer = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Audio Bridge",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Audio bridge service notification");
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

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
            if (conn != null && conn == activeClient) {
                stopCapture();
                activeClient = null;
            }
        }

        @Override
        public void onStart() {
            Log.i(TAG, "WebSocket server listening on port " + WS_PORT);
        }

        private void startCapture(WebSocket client) {
            int minBufSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
            int bufferSize = Math.max(minBufSize, FRAME_SIZE * 4);

            try {
                audioRecord = new AudioRecord(
                        MediaRecorder.AudioSource.MIC,
                        SAMPLE_RATE,
                        CHANNEL_CONFIG,
                        AUDIO_FORMAT,
                        bufferSize
                );
            } catch (SecurityException e) {
                Log.e(TAG, "RECORD_AUDIO permission not granted", e);
                client.send("{\"error\":\"RECORD_AUDIO permission not granted\"}");
                client.close(1011, "Permission denied");
                activeClient = null;
                return;
            }

            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord failed to initialize");
                client.send("{\"error\":\"AudioRecord failed to initialize\"}");
                client.close(1011, "AudioRecord init failed");
                audioRecord.release();
                audioRecord = null;
                activeClient = null;
                return;
            }

            capturing = true;
            audioRecord.startRecording();
            Log.i(TAG, "AudioRecord started: source=MIC rate=" + SAMPLE_RATE
                    + " bufferSize=" + bufferSize + " minBufSize=" + minBufSize);

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

                Log.i(TAG, "Capture loop ended after " + frameCount + " frames");
            }, "AudioBridge-Capture");
            captureThread.setPriority(Thread.MAX_PRIORITY);
            captureThread.start();
        }

        private void stopCapture() {
            capturing = false;

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
