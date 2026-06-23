// OboeOutput.h — opens an Oboe output stream and pulls VoiceHost::render in the
// audio callback. Restarts the stream on error.
//
// STATUS: UNBUILT SCAFFOLD. Compiles once find_package(oboe) succeeds.
#pragma once

#include "VoiceHost.h"
#include <oboe/Oboe.h>
#include <atomic>

namespace pianobridge {

class OboeOutput : public oboe::AudioStreamDataCallback,
                   public oboe::AudioStreamErrorCallback {
public:
    explicit OboeOutput(VoiceHost* host);
    ~OboeOutput() override;

    bool start();   // open + start the stream
    void stop();    // stop + close the stream

    int  xruns() const { return xruns_.load(); }
    // Rough CPU-load estimate (callback-time / callback-period), 0..1.
    float cpuLoad() const { return cpuLoad_.load(); }

    // oboe::AudioStreamDataCallback
    oboe::DataCallbackResult onAudioReady(oboe::AudioStream* stream,
                                          void* audioData,
                                          int32_t numFrames) override;

    // oboe::AudioStreamErrorCallback
    void onErrorAfterClose(oboe::AudioStream* stream, oboe::Result error) override;

private:
    bool openStream();

    VoiceHost* host_;
    std::shared_ptr<oboe::AudioStream> stream_;
    std::atomic<int>   xruns_{0};
    std::atomic<float> cpuLoad_{0.0f};
};

} // namespace pianobridge
