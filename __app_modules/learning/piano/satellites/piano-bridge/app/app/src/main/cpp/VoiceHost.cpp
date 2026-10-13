// VoiceHost.cpp — see header.
#include "VoiceHost.h"
#include "SfizzEngine.h"
#include "DexedEngine.h"

#include <android/log.h>
#include <cstring>

#define LOG_TAG "PianoBridge-host"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

namespace pianobridge {

VoiceHost::VoiceHost(double sampleRate) : sampleRate_(sampleRate) {
    LOGI("VoiceHost created sr=%.0f", sampleRate_);
}

VoiceHost::~VoiceHost() {
    active_.store(nullptr, std::memory_order_release);
}

bool VoiceHost::loadPreset(const VoiceSpec& spec) {
    std::shared_ptr<Engine> next;
    if (spec.engine == "sfizz") {
        next = std::make_shared<SfizzEngine>(sampleRate_);
    } else if (spec.engine == "dexed") {
        next = std::make_shared<DexedEngine>(sampleRate_);
    } else {
        LOGW("Unknown engine '%s'", spec.engine.c_str());
        return false;
    }

    if (!next->load(spec)) {
        LOGW("engine '%s' failed to load asset %s",
             spec.engine.c_str(), spec.assetPath.c_str());
        return false;
    }

    {
        std::lock_guard<std::mutex> lk(swapMutex_);
        // Publish the new engine pointer atomically for the audio thread, then
        // keep the old shared_ptr alive until after we've swapped owners so the
        // render thread never dereferences a freed engine.
        std::shared_ptr<Engine> prev = engine_;
        engine_ = next;
        active_.store(engine_.get(), std::memory_order_release);
        // prev (if any) is destroyed at end of scope, after active_ no longer
        // points at it. The audio callback reads active_ once per block.
    }
    LOGI("Loaded preset engine=%s", spec.engine.c_str());
    return true;
}

void VoiceHost::noteOn(int note, int velocity) {
    std::lock_guard<std::mutex> lk(swapMutex_);
    if (engine_) engine_->noteOn(note, velocity);
}

void VoiceHost::noteOff(int note) {
    std::lock_guard<std::mutex> lk(swapMutex_);
    if (engine_) engine_->noteOff(note);
}

void VoiceHost::setParam(const std::string& path, float value) {
    std::lock_guard<std::mutex> lk(swapMutex_);
    if (engine_) engine_->setParam(path, value);
}

void VoiceHost::panic() {
    std::lock_guard<std::mutex> lk(swapMutex_);
    if (engine_) engine_->allNotesOff();
}

void VoiceHost::render(float* out, int frames) {
    Engine* e = active_.load(std::memory_order_acquire);
    if (e && gateOpen_.load(std::memory_order_acquire)) {
        e->render(out, frames);
    } else {
        std::memset(out, 0, sizeof(float) * frames * 2); // silence
    }
}

} // namespace pianobridge
