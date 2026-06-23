# CMakeLists.txt — native synth host for Piano Bridge.
#
# STATUS: UNBUILT SCAFFOLD. There is NO Android NDK / cmake on the authoring
# machine, so this has NOT been configured or compiled. It is written to be
# internally consistent: it links WITHOUT sfizz/dexed (the engines fall back to
# silence via #ifdef guards). Enable real DSP by vendoring those libs and
# uncommenting the marked blocks below.

cmake_minimum_required(VERSION 3.22.1)
project(pianobridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- Oboe (low-latency audio output) ---
# Provided by the Gradle dependency com.google.oboe:oboe (prefab). The Android
# Gradle plugin exposes it to CMake via find_package CONFIG.
find_package(oboe REQUIRED CONFIG)

add_library(pianobridge SHARED
        native-lib.cpp
        VoiceHost.cpp
        OboeOutput.cpp
        SfizzEngine.cpp
        DexedEngine.cpp)

target_link_libraries(pianobridge
        oboe::oboe
        android
        log)

# ---------------------------------------------------------------------------
# Real DSP engines.
#
# --- sfizz (SFZ sampler) — ENABLED (vendored under third_party/sfizz) ---
set(SFIZZ_JACK       OFF CACHE BOOL "" FORCE)
set(SFIZZ_RENDER     OFF CACHE BOOL "" FORCE)
set(SFIZZ_SHARED     OFF CACHE BOOL "" FORCE)
set(SFIZZ_TESTS      OFF CACHE BOOL "" FORCE)
set(SFIZZ_DEMOS      OFF CACHE BOOL "" FORCE)
set(SFIZZ_DEVTOOLS   OFF CACHE BOOL "" FORCE)
set(SFIZZ_BENCHMARKS OFF CACHE BOOL "" FORCE)
set(SFIZZ_USE_SNDFILE OFF CACHE BOOL "" FORCE)   # use bundled st_audiofile/dr_libs (WAV)
add_subdirectory(third_party/sfizz EXCLUDE_FROM_ALL)
target_link_libraries(pianobridge sfizz::sfizz)
target_include_directories(pianobridge PRIVATE third_party/sfizz/src)
target_compile_definitions(pianobridge PRIVATE HAVE_SFIZZ)
#
# --- dexed / MSFA (DX7 FM core) --- still disabled (vendor later) ---
# --- dexed / MSFA (DX7 FM core) ---
# add_library(msfa STATIC
#         third_party/dexed/msfa/dx7note.cc
#         third_party/dexed/msfa/env.cc
#         third_party/dexed/msfa/exp2.cc
#         third_party/dexed/msfa/fm_core.cc
#         third_party/dexed/msfa/fm_op_kernel.cc
#         third_party/dexed/msfa/freqlut.cc
#         third_party/dexed/msfa/lfo.cc
#         third_party/dexed/msfa/pitchenv.cc
#         third_party/dexed/msfa/sin.cc
#         third_party/dexed/msfa/tuning.cc)
# target_include_directories(msfa PUBLIC third_party/dexed/msfa)
# target_link_libraries(pianobridge msfa)
# target_compile_definitions(pianobridge PRIVATE HAVE_DEXED)
# ---------------------------------------------------------------------------
