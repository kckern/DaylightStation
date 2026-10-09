// Engine.h — abstract synth engine interface + the resolved voice spec.
//
// STATUS: UNBUILT SCAFFOLD. This header is internally consistent and would
// compile once Oboe + (optionally) sfizz/dexed are vendored. With HAVE_SFIZZ /
// HAVE_DEXED undefined, the concrete engines render SILENCE (not a build error).
#pragma once

#include <string>

namespace pianobridge {

// Mirrors the WS preset.load "spec" contract (frontend instrumentSpec.js).
// reverb/eq/chorus are flattened into the scalars the engines actually consume;
// ControlServer resolves the object form before crossing JNI.
struct VoiceSpec {
    std::string engine;          // "sfizz" | "dexed"
    std::string assetPath;       // absolute, already path-guarded by ControlServer
    int   patch         = 0;     // dexed bank/patch index; ignored by sfizz
    float gainDb        = 0.0f;  // output trim in dB
    int   transpose     = 0;     // semitones
    int   tune          = 0;     // cents
    std::string velocityCurve = "natural"; // natural|linear|soft|hard
    float reverbMix     = 0.0f;  // 0..1 wet mix
};

// One polyphonic synth voice source. All methods except render() are called
// from the JNI/control thread; render() is called from the Oboe audio callback.
// Implementations must make engine swaps safe relative to render() (VoiceHost
// owns that synchronization).
class Engine {
public:
    virtual ~Engine() = default;

    // Load/replace the active instrument. Returns false on failure.
    virtual bool load(const VoiceSpec& spec) = 0;

    virtual void noteOn(int note, int velocity) = 0;
    virtual void noteOff(int note) = 0;
    virtual void controlChange(int cc, int value) = 0;

    // Generic dotted-path param set (e.g. "reverb.mix", "cc.64").
    virtual void setParam(const std::string& path, float value) = 0;

    // Render `frames` stereo-interleaved float samples into `out`
    // (length = frames * 2). Must be real-time safe: no locks, no allocation.
    virtual void render(float* out, int frames) = 0;

    // Flush all sounding voices (panic).
    virtual void allNotesOff() = 0;
};

} // namespace pianobridge
