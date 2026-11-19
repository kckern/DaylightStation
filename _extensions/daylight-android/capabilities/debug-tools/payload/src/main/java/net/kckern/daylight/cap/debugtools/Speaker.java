package net.kckern.daylight.cap.debugtools;

import android.content.Context;
import android.speech.tts.TextToSpeech;

import net.kckern.daylight.core.UnsupportedException;

import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** POST /speak. The engine is created on first use and kept until shutdown. Called from a request thread. */
final class Speaker implements DebugToolsCapability.Speech {
    private TextToSpeech tts;
    private volatile int initStatus = TextToSpeech.ERROR;
    private final AtomicInteger utterances = new AtomicInteger();

    /** True once the engine has accepted the utterance into its queue. */
    @Override public synchronized boolean speak(Context context, String text, String locale) throws InterruptedException {
        if (tts == null) {
            final CountDownLatch ready = new CountDownLatch(1);
            tts = new TextToSpeech(context.getApplicationContext(), status -> { initStatus = status; ready.countDown(); });
            if (!ready.await(5, TimeUnit.SECONDS)) initStatus = TextToSpeech.ERROR;
        }
        if (initStatus != TextToSpeech.SUCCESS) {
            try { tts.shutdown(); } catch (Throwable ignored) { }
            tts = null;
            throw new UnsupportedException("no text-to-speech engine on this device");
        }
        if (locale != null && !locale.isEmpty()) {
            int available = tts.setLanguage(Locale.forLanguageTag(locale));
            if (available == TextToSpeech.LANG_MISSING_DATA || available == TextToSpeech.LANG_NOT_SUPPORTED) {
                throw new UnsupportedException("the text-to-speech engine has no voice for locale " + locale);
            }
        }
        return tts.speak(text, TextToSpeech.QUEUE_ADD, null, "daylight-" + utterances.incrementAndGet()) == TextToSpeech.SUCCESS;
    }

    @Override public synchronized void shutdown() {
        if (tts != null) { try { tts.shutdown(); } catch (Throwable ignored) { } tts = null; }
    }
}
