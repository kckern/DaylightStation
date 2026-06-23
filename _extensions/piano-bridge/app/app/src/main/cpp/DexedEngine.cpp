// DexedEngine.cpp — see header. Silent fallback when HAVE_DEXED is undefined.
#include "DexedEngine.h"

#include <android/log.h>
#include <cmath>
#include <cstdio>
#include <cstring>

#define LOG_TAG "PianoBridge-dexed"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

namespace pianobridge {

DexedEngine::DexedEngine(double sampleRate) : sampleRate_(sampleRate) {
#ifdef HAVE_DEXED
    LOGI("DexedEngine created (dexed/msfa vendored) sr=%.0f", sampleRate_);
    // Init msfa global tables here: Exp2::init(); Tanh::init(); Sin::init();
    // Freqlut::init(sampleRate_); Lfo::init(sampleRate_); PitchEnv::init(sampleRate_);
    // Env::init_sr(sampleRate_);
#else
    LOGW("DexedEngine created in SILENT mode — dexed/msfa not vendored "
         "(define HAVE_DEXED + add the msfa sources to CMakeLists.txt to enable)");
#endif
}

DexedEngine::~DexedEngine() = default;

bool DexedEngine::load(const VoiceSpec& spec) {
    gainLinear_ = std::pow(10.0f, spec.gainDb / 20.0f);
    transpose_  = spec.transpose;
    tune_       = spec.tune;
    patch_      = spec.patch;
    reverbMix_  = spec.reverbMix;

    // Read the .syx bank from disk (path already guarded by ControlServer).
    FILE* f = std::fopen(spec.assetPath.c_str(), "rb");
    if (!f) {
        LOGW("Failed to open DX7 bank: %s", spec.assetPath.c_str());
        return false;
    }
    std::fseek(f, 0, SEEK_END);
    long size = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    bankData_.resize(static_cast<size_t>(size > 0 ? size : 0));
    if (size > 0) {
        size_t rd = std::fread(bankData_.data(), 1, static_cast<size_t>(size), f);
        (void) rd;
    }
    std::fclose(f);
    LOGI("Read DX7 bank %s (%ld bytes), patch=%d", spec.assetPath.c_str(), size, patch_);

#ifdef HAVE_DEXED
    // Strip the 6-byte sysex header if present, unpack the selected 128-byte
    // packed patch via Dx7Note / load into the active voice template.
    loaded_ = true;
    return true;
#else
    loaded_ = true; // pretend-loaded so the silent path renders cleanly
    return true;
#endif
}

void DexedEngine::noteOn(int note, int velocity) {
#ifdef HAVE_DEXED
    // allocate a Dx7Note voice; apply transpose_/tune_ to the pitch.
    (void) note; (void) velocity;
#else
    (void) note; (void) velocity;
#endif
}

void DexedEngine::noteOff(int note) {
#ifdef HAVE_DEXED
    (void) note; // trigger release on the matching voice
#else
    (void) note;
#endif
}

void DexedEngine::controlChange(int cc, int value) {
    (void) cc; (void) value; // mod wheel -> LFO depth, sustain pedal, etc.
}

void DexedEngine::setParam(const std::string& path, float value) {
    if (path == "reverb.mix") reverbMix_ = value;
    else if (path == "gain")  gainLinear_ = value;
    // "cc.*" routed via controlChange by the caller if desired.
}

void DexedEngine::render(float* out, int frames) {
#ifdef HAVE_DEXED
    // Sum active Dx7Note voices into a mono buffer, scale by gainLinear_,
    // duplicate to stereo. MSFA renders in 64-sample control blocks.
    std::memset(out, 0, sizeof(float) * frames * 2);
    // ... real FM render loop here ...
#else
    std::memset(out, 0, sizeof(float) * frames * 2); // silence
#endif
}

void DexedEngine::allNotesOff() {
#ifdef HAVE_DEXED
    // release/kill all voices
#endif
}

} // namespace pianobridge
