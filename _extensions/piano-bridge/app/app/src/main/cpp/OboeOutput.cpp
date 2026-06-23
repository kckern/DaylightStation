// OboeOutput.cpp — see header.
#include "OboeOutput.h"

#include <android/log.h>

#define LOG_TAG "PianoBridge-oboe"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace pianobridge {

static constexpr int    kChannelCount = 2;       // stereo
static constexpr int    kSampleRate   = 48000;

OboeOutput::OboeOutput(VoiceHost* host) : host_(host) {}

OboeOutput::~OboeOutput() { stop(); }

bool OboeOutput::openStream() {
    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Output)
           ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
           ->setSharingMode(oboe::SharingMode::Exclusive) // may be downgraded to Shared
           ->setFormat(oboe::AudioFormat::Float)
           ->setChannelCount(kChannelCount)
           ->setSampleRate(kSampleRate)
           ->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium)
           ->setDataCallback(this)
           ->setErrorCallback(this);

    oboe::Result result = builder.openStream(stream_);
    if (result != oboe::Result::OK) {
        LOGE("Failed to open Oboe stream: %s", oboe::convertToText(result));
        return false;
    }

    // Log what we actually got (Exclusive/LowLatency are best-effort).
    LOGI("Oboe stream opened: sr=%d ch=%d perfMode=%s sharing=%s framesPerBurst=%d",
         stream_->getSampleRate(),
         stream_->getChannelCount(),
         oboe::convertToText(stream_->getPerformanceMode()),
         oboe::convertToText(stream_->getSharingMode()),
         stream_->getFramesPerBurst());

    // Aim buffer at 2 bursts for low latency without constant underruns.
    stream_->setBufferSizeInFrames(stream_->getFramesPerBurst() * 2);
    return true;
}

bool OboeOutput::start() {
    if (!openStream()) return false;
    oboe::Result result = stream_->requestStart();
    if (result != oboe::Result::OK) {
        LOGE("requestStart failed: %s", oboe::convertToText(result));
        return false;
    }
    LOGI("Oboe stream started");
    return true;
}

void OboeOutput::stop() {
    if (stream_) {
        stream_->stop();
        stream_->close();
        stream_.reset();
        LOGI("Oboe stream stopped");
    }
}

oboe::DataCallbackResult OboeOutput::onAudioReady(oboe::AudioStream* stream,
                                                  void* audioData,
                                                  int32_t numFrames) {
    (void) stream;
    float* out = static_cast<float*>(audioData);
    host_->render(out, numFrames);

    // Track xruns for the status heartbeat.
    auto x = stream_->getXRunCount();
    if (x) xruns_.store(x.value());

    return oboe::DataCallbackResult::Continue;
}

void OboeOutput::onErrorAfterClose(oboe::AudioStream* /*stream*/, oboe::Result error) {
    LOGW("Oboe stream error after close: %s — restarting", oboe::convertToText(error));
    // Disconnect (e.g. headphones unplugged) closes the stream; re-open.
    stop();
    start();
}

} // namespace pianobridge
