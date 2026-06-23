// VoiceHost.h — owns the active Engine, switches engines on loadPreset, and is
// the single render source consumed by OboeOutput's audio callback.
//
// STATUS: UNBUILT SCAFFOLD (see Engine.h). Self-consistent; compiles once Oboe
// is found. sfizz/dexed engines fall back to silence until vendored.
#pragma once

#include "Engine.h"
#include <atomic>
#include <memory>
#include <mutex>
#include <string>

namespace pianobridge {

class VoiceHost {
public:
    explicit VoiceHost(double sampleRate);
    ~VoiceHost();

    // Build the engine named by spec.engine ("sfizz"|"dexed") and load it.
    // Thread-safe vs. render(): swaps under a lock; render() reads atomically.
    bool loadPreset(const VoiceSpec& spec);

    void noteOn(int note, int velocity);
    void noteOff(int note);
    void setParam(const std::string& path, float value);
    void panic();

    // Real-time audio callback entry point. Stereo-interleaved, frames*2 floats.
    // If no engine is active, fills silence.
    void render(float* out, int frames);

    double sampleRate() const { return sampleRate_; }

private:
    double sampleRate_;

    // The render thread reads engine_ via the raw pointer cached under the lock.
    // Engine swaps are infrequent (preset changes), so a mutex on the control
    // side + an atomic "active" snapshot for the audio side is sufficient.
    std::mutex swapMutex_;
    std::shared_ptr<Engine> engine_;          // owned; replaced on loadPreset
    std::atomic<Engine*> active_{nullptr};    // lock-free snapshot for render()
};

} // namespace pianobridge
