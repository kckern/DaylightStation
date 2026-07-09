// native-lib.cpp — JNI bindings mapping PianoEngine.java natives onto the
// VoiceHost + OboeOutput bundle.
//
// STATUS: UNBUILT SCAFFOLD. Self-consistent; compiles once Oboe is found.
// sfizz/dexed render silence until vendored (HAVE_SFIZZ / HAVE_DEXED).
//
// The Java side passes an opaque `long handle` that is a pointer to a NativeBundle
// allocated in nativeInit() and freed in nativeRelease().
#include <jni.h>
#include <android/log.h>
#include <memory>
#include <string>

#include "VoiceHost.h"
#include "OboeOutput.h"

#define LOG_TAG "PianoBridge-jni"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

using namespace pianobridge;

namespace {

constexpr double kSampleRate = 48000.0;

struct NativeBundle {
    std::unique_ptr<VoiceHost> host;
    std::unique_ptr<OboeOutput> output;
};

inline NativeBundle* fromHandle(jlong h) {
    return reinterpret_cast<NativeBundle*>(h);
}

std::string jstr(JNIEnv* env, jstring s) {
    if (!s) return {};
    const char* c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

} // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeInit(JNIEnv* /*env*/, jclass /*clazz*/) {
    auto* b = new NativeBundle();
    b->host = std::make_unique<VoiceHost>(kSampleRate);
    b->output = std::make_unique<OboeOutput>(b->host.get());
    LOGI("nativeInit -> %p", b);
    return reinterpret_cast<jlong>(b);
}

JNIEXPORT jboolean JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeStart(JNIEnv* /*env*/, jclass /*clazz*/, jlong handle) {
    auto* b = fromHandle(handle);
    if (!b || !b->output) return JNI_FALSE;
    return b->output->start() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeStop(JNIEnv* /*env*/, jclass /*clazz*/, jlong handle) {
    auto* b = fromHandle(handle);
    if (b && b->output) b->output->stop();
}

JNIEXPORT jboolean JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeLoadPreset(
        JNIEnv* env, jclass /*clazz*/, jlong handle,
        jstring engine, jstring assetPath, jint patch, jfloat gainDb,
        jint transpose, jint tune, jstring velocityCurve, jfloat reverbMix) {
    auto* b = fromHandle(handle);
    if (!b || !b->host) return JNI_FALSE;
    VoiceSpec spec;
    spec.engine        = jstr(env, engine);
    spec.assetPath     = jstr(env, assetPath);
    spec.patch         = patch;
    spec.gainDb        = gainDb;
    spec.transpose     = transpose;
    spec.tune          = tune;
    spec.velocityCurve = jstr(env, velocityCurve);
    spec.reverbMix     = reverbMix;
    return b->host->loadPreset(spec) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeSetParam(
        JNIEnv* env, jclass /*clazz*/, jlong handle, jstring path, jfloat value) {
    auto* b = fromHandle(handle);
    if (b && b->host) b->host->setParam(jstr(env, path), value);
}

JNIEXPORT void JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeNoteOn(
        JNIEnv* /*env*/, jclass /*clazz*/, jlong handle, jint note, jint velocity) {
    auto* b = fromHandle(handle);
    if (b && b->host) b->host->noteOn(note, velocity);
}

JNIEXPORT void JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeNoteOff(
        JNIEnv* /*env*/, jclass /*clazz*/, jlong handle, jint note) {
    auto* b = fromHandle(handle);
    if (b && b->host) b->host->noteOff(note);
}

JNIEXPORT void JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativePanic(JNIEnv* /*env*/, jclass /*clazz*/, jlong handle) {
    auto* b = fromHandle(handle);
    if (b && b->host) b->host->panic();
}

JNIEXPORT void JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeRelease(JNIEnv* /*env*/, jclass /*clazz*/, jlong handle) {
    auto* b = fromHandle(handle);
    if (!b) return;
    if (b->output) b->output->stop();
    delete b; // unique_ptrs tear down output then host
    LOGI("nativeRelease %p", b);
}

JNIEXPORT jfloat JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeCpuLoad(JNIEnv* /*env*/, jclass /*clazz*/, jlong handle) {
    auto* b = fromHandle(handle);
    return (b && b->output) ? b->output->cpuLoad() : -1.0f;
}

JNIEXPORT jint JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeXruns(JNIEnv* /*env*/, jclass /*clazz*/, jlong handle) {
    auto* b = fromHandle(handle);
    return (b && b->output) ? b->output->xruns() : -1;
}

JNIEXPORT void JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeSetOutputGate(
        JNIEnv* /*env*/, jclass /*clazz*/, jlong handle, jboolean open) {
    auto* b = fromHandle(handle);
    if (b && b->host) b->host->setOutputGate(open == JNI_TRUE);
}

} // extern "C"
