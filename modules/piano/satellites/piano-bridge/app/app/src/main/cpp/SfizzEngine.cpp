// SfizzEngine.cpp — see header. Silent fallback when HAVE_SFIZZ is undefined.
#include "SfizzEngine.h"

#include <android/log.h>
#include <cmath>
#include <cstring>

#define LOG_TAG "PianoBridge-sfizz"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN,  LOG_TAG, __VA_ARGS__)

namespace pianobridge {

SfizzEngine::SfizzEngine(double sampleRate) : sampleRate_(sampleRate) {
#ifdef HAVE_SFIZZ
    synth_ = std::make_unique<sfz::Sfizz>();
    synth_->setSampleRate(static_cast<float>(sampleRate_));
    synth_->setSamplesPerBlock(1024);
    LOGI("SfizzEngine created (sfizz vendored) sr=%.0f", sampleRate_);
#else
    LOGW("SfizzEngine created in SILENT mode — sfizz not vendored "
         "(define HAVE_SFIZZ + add_subdirectory(third_party/sfizz) to enable)");
#endif
}

SfizzEngine::~SfizzEngine() = default;

float SfizzEngine::applyVelocityCurve(int velocity) const {
    float v = velocity / 127.0f;
    if (velocityCurve_ == "linear") return v;
    if (velocityCurve_ == "soft")   return v * v;            // quieter low end
    if (velocityCurve_ == "hard")   return std::sqrt(v);     // louder low end
    // "natural" — gentle expo
    return v * v * (3.0f - 2.0f * v);
}

bool SfizzEngine::load(const VoiceSpec& spec) {
    gainLinear_    = std::pow(10.0f, spec.gainDb / 20.0f);
    transpose_     = spec.transpose;
    tune_          = spec.tune;
    reverbMix_     = spec.reverbMix;
    velocityCurve_ = spec.velocityCurve;

#ifdef HAVE_SFIZZ
    bool ok = synth_->loadSfzFile(spec.assetPath);
    if (!ok) { LOGW("loadSfzFile failed: %s", spec.assetPath.c_str()); return false; }
    synth_->setVolume(spec.gainDb);
    synth_->setScalaRootKey(60 + transpose_);
    synth_->setTuningFrequency(440.0f * std::pow(2.0f, tune_ / 1200.0f));
    loaded_ = true;
    LOGI("Loaded SFZ: %s (regions ready)", spec.assetPath.c_str());
    return true;
#else
    LOGW("load() ignored — sfizz not vendored (asset=%s)", spec.assetPath.c_str());
    loaded_ = true; // pretend-loaded so the silent path renders cleanly
    return true;
#endif
}

void SfizzEngine::noteOn(int note, int velocity) {
#ifdef HAVE_SFIZZ
    float v = applyVelocityCurve(velocity);
    synth_->noteOn(0, note + transpose_, static_cast<int>(v * 127.0f));
#else
    (void) note; (void) velocity;
#endif
}

void SfizzEngine::noteOff(int note) {
#ifdef HAVE_SFIZZ
    synth_->noteOff(0, note + transpose_, 0);
#else
    (void) note;
#endif
}

void SfizzEngine::controlChange(int cc, int value) {
#ifdef HAVE_SFIZZ
    synth_->cc(0, cc, value);
#else
    (void) cc; (void) value;
#endif
}

void SfizzEngine::setParam(const std::string& path, float value) {
    if (path == "reverb.mix") reverbMix_ = value;
    else if (path == "gain")  gainLinear_ = value;
#ifdef HAVE_SFIZZ
    else if (path.rfind("cc.", 0) == 0) {
        int cc = std::atoi(path.c_str() + 3);
        synth_->cc(0, cc, static_cast<int>(value * 127.0f));
    }
#endif
}

void SfizzEngine::render(float* out, int frames) {
#ifdef HAVE_SFIZZ
    // sfizz renders into two mono channel buffers; interleave to stereo.
    // (A production build would keep scratch buffers as members to avoid VLAs.)
    float left[frames];
    float right[frames];
    float* chans[2] = { left, right };
    // sfizz: 3rd arg is the number of STEREO output pairs (not channels). One
    // stereo output writes exactly these 2 L/R buffers; passing 2 made sfizz
    // write to 4 buffers (chans[2]/[3] don't exist) -> SIGSEGV.
    synth_->renderBlock(chans, frames, 1);
    float peak = 0.0f;
    for (int i = 0; i < frames; ++i) {
        out[2 * i]     = left[i]  * gainLinear_;
        out[2 * i + 1] = right[i] * gainLinear_;
        float a = std::fabs(left[i]); if (a > peak) peak = a;
    }
    // Sampled signal-present log (proves non-silence; throttled to ~1/100 blocks).
    static int rc = 0;
    if (peak > 0.001f && (++rc % 100 == 0)) LOGI("render signal peak=%.3f", peak);
    // reverbMix_ would feed a shared reverb send here.
#else
    std::memset(out, 0, sizeof(float) * frames * 2); // silence
#endif
}

void SfizzEngine::allNotesOff() {
#ifdef HAVE_SFIZZ
    synth_->allSoundOff();
#endif
}

} // namespace pianobridge
