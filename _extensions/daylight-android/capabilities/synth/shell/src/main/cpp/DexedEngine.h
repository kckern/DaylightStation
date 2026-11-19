// DexedEngine.h — DX7-style FM engine backed by the MSFA/Dexed core.
//
// STATUS: UNBUILT SCAFFOLD. Real Dexed/MSFA calls are compiled only when
// HAVE_DEXED is defined (after vendoring the msfa/dexed sources and enabling
// them in CMakeLists.txt). Otherwise this engine renders silence.
#pragma once

#include "Engine.h"
#include <cstdint>
#include <vector>

namespace pianobridge {

class DexedEngine : public Engine {
public:
    explicit DexedEngine(double sampleRate);
    ~DexedEngine() override;

    bool load(const VoiceSpec& spec) override;   // loads .syx bank, selects spec.patch
    void noteOn(int note, int velocity) override;
    void noteOff(int note) override;
    void controlChange(int cc, int value) override;
    void setParam(const std::string& path, float value) override;
    void render(float* out, int frames) override;
    void allNotesOff() override;

private:
    double sampleRate_;
    float  gainLinear_ = 1.0f;
    int    transpose_  = 0;
    int    tune_       = 0;
    int    patch_      = 0;
    float  reverbMix_  = 0.0f;
    bool   loaded_     = false;

    // 32-voice DX7 banks are 4096 bytes (32 * 128) of packed patch data.
    std::vector<uint8_t> bankData_;

#ifdef HAVE_DEXED
    // e.g. std::unique_ptr<Dx7Note> voices_[kMaxNotes]; Lfo lfo_; etc.
    // (declared here once msfa/dexed headers are vendored)
#endif
};

} // namespace pianobridge
