// OboeOutput.h — opens an Oboe output stream and pulls VoiceHost::render in the
// audio callback. Restarts the stream on error.
//
// STATUS: UNBUILT SCAFFOLD. Compiles once find_package(oboe) succeeds.
#pragma once

#include "VoiceHost.h"
#include <oboe/Oboe.h>
#include <atomic>
#include <mutex>

namespace pianobridge {

class OboeOutput : public oboe::AudioStreamDataCallback,
                   public oboe::AudioStreamErrorCallback {
public:
    explicit OboeOutput(VoiceHost* host);
    ~OboeOutput() override;

    bool start();   // open + start the stream
    void stop();    // stop + close the stream

    /** True iff a stream exists and is Started. Lets the reconciler stay idempotent.
     *  Takes streamMutex_ to read stream_ safely against Oboe's error thread. */
    bool isRunning() const;

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
    // The *Locked helpers assume streamMutex_ is already held; the public
    // start()/stop()/isRunning() take the lock once and delegate. This keeps the
    // mutex non-recursive while letting start() reuse stopLocked() internally.
    bool openStreamLocked();       // assumes streamMutex_ held
    void stopLocked();             // assumes streamMutex_ held
    bool isRunningLocked() const;  // assumes streamMutex_ held

    VoiceHost* host_;
    // stream_ is mutated by Oboe's error-dispatch thread (via stop) and by JNI
    // threads (via start/isRunning). streamMutex_ serializes those; the real-time
    // onAudioReady must NOT take it — it uses the stream passed in as a parameter.
    mutable std::mutex streamMutex_;
    std::shared_ptr<oboe::AudioStream> stream_;
    std::atomic<int>   xruns_{0};
    std::atomic<float> cpuLoad_{0.0f};
};

} // namespace pianobridge
