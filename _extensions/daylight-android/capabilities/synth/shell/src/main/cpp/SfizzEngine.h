// SfizzEngine.h — SFZ-sampler engine backed by sfizz.
//
// Built and shipped. CMakeLists.txt requires the vendored sfizz tree and defines
// HAVE_SFIZZ, so the sfizz calls are always compiled in.
#pragma once

#include "Engine.h"

#ifdef HAVE_SFIZZ
#include <sfizz.hpp>
#include <memory>
#endif

namespace pianobridge {

class SfizzEngine : public Engine {
public:
    explicit SfizzEngine(double sampleRate);
    ~SfizzEngine() override;

    bool load(const VoiceSpec& spec) override;
    void noteOn(int note, int velocity) override;
    void noteOff(int note) override;
    void controlChange(int cc, int value) override;
    void setParam(const std::string& path, float value) override;
    void render(float* out, int frames) override;
    void allNotesOff() override;

private:
    double sampleRate_;
    // Resolved from VoiceSpec; applied per-note where the real path exists.
    float gainLinear_   = 1.0f;
    int   transpose_    = 0;
    int   tune_         = 0;
    float reverbMix_    = 0.0f;
    std::string velocityCurve_ = "natural";
    bool  loaded_       = false;

    float applyVelocityCurve(int velocity) const; // 0..1

#ifdef HAVE_SFIZZ
    std::unique_ptr<sfz::Sfizz> synth_;
#endif
};

} // namespace pianobridge
