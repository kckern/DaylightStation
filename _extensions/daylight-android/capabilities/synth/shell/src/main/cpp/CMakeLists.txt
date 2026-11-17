# CMakeLists.txt: native synth host (sfizz through Oboe), built as libpianobridge.so.
#
# Shipped since the piano-bridge shell v30. sfizz is required: Gradle passes
# SFIZZ_DIR (sfizz.dir in local.properties), and configuration stops without it.
# The Dexed engine is compiled out; its block below is kept for when it is vendored.

cmake_minimum_required(VERSION 3.22.1)

# The sampler renders in the audio callback on a slow tablet. The Android plugin asks
# for CMake's unoptimized Debug build for the debug variant, and the debug APK is what
# gets installed, so every variant is built RelWithDebInfo (-O2 -g -DNDEBUG) here.
# Packaging strips the debug info. Each variant keeps its own build directory.
set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "Every variant ships optimized" FORCE)

project(pianobridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Source paths reach the library through __FILE__ (assert and log strings) and through
# debug info. Map every build-machine prefix to a fixed name so the shipped library
# says nothing about where it was built. Set before any target so sfizz inherits it.
function(daylight_map_prefix dir name)
    if(dir AND EXISTS "${dir}")
        get_filename_component(real "${dir}" REALPATH)
        foreach(d IN ITEMS "${dir}" "${real}")
            add_compile_options("-ffile-prefix-map=${d}=${name}" "-fmacro-prefix-map=${d}=${name}")
        endforeach()
    endif()
endfunction()
daylight_map_prefix("${DAYLIGHT_ROOT}" "daylight-android")
daylight_map_prefix("${CMAKE_CURRENT_SOURCE_DIR}" "synth")
daylight_map_prefix("${SFIZZ_DIR}" "sfizz")
daylight_map_prefix("${CMAKE_ANDROID_NDK}" "ndk")
daylight_map_prefix("${DAYLIGHT_GRADLE_HOME}" "gradle-home")

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
# --- sfizz (SFZ sampler) ---
# The vendored tree lives outside git. A library built without it would load and
# make no sound, so a missing tree is an error here, not a fallback.
if(NOT SFIZZ_DIR OR NOT EXISTS "${SFIZZ_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "sfizz not found at '${SFIZZ_DIR}': set sfizz.dir in local.properties to the vendored sfizz tree")
endif()
# sfizz's own configure step otherwise runs `git submodule update --init` inside the
# vendored tree whenever a submodule has no CMakeLists.txt, which rewrites files there.
# The tree is used as it is; a missing submodule shows up as a compile error.
set(SFIZZ_GIT_SUBMODULE_CHECK OFF CACHE BOOL "" FORCE)
set(SFIZZ_JACK       OFF CACHE BOOL "" FORCE)
set(SFIZZ_RENDER     OFF CACHE BOOL "" FORCE)
set(SFIZZ_SHARED     OFF CACHE BOOL "" FORCE)
set(SFIZZ_TESTS      OFF CACHE BOOL "" FORCE)
set(SFIZZ_DEMOS      OFF CACHE BOOL "" FORCE)
set(SFIZZ_DEVTOOLS   OFF CACHE BOOL "" FORCE)
set(SFIZZ_BENCHMARKS OFF CACHE BOOL "" FORCE)
set(SFIZZ_USE_SNDFILE OFF CACHE BOOL "" FORCE)   # use bundled st_audiofile/dr_libs (WAV)
add_subdirectory(${SFIZZ_DIR} ${CMAKE_BINARY_DIR}/sfizz EXCLUDE_FROM_ALL)
target_link_libraries(pianobridge sfizz::sfizz)
target_include_directories(pianobridge PRIVATE ${SFIZZ_DIR}/src)
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
