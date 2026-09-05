#include "PressureMatDetector.h"
#include <cassert>
#include <iostream>
#include <limits>

struct Trace {
  PressureMatDetector detector;
  uint32_t now = 0;
  int presses = 0, releases = 0, stomps = 0, rearms = 0;
  void frame(float v, uint32_t ms = 50) {
    now += ms;
    const auto events = detector.sample(v, now);
    presses += events.pressed; releases += events.released;
    stomps += events.stomped; rearms += events.rearmed;
  }
  void hold(float v, int frames) { for (int i = 0; i < frames; i++) frame(v); }
};

int main() {
  {
    Trace t; t.frame(3); t.frame(2.8f); t.hold(2.8f, 5); t.hold(3, 5);
    assert(t.presses == 1 && t.releases == 1 && t.stomps == 0);
    t.frame(2.3f); t.hold(2.3f, 8); t.hold(3, 5);
    assert(t.presses == 2 && t.releases == 2 && t.stomps == 1);
    assert(t.detector.state().steps == 2 && t.detector.state().stomps == 1);
  }
  {
    Trace t; t.frame(3); t.frame(2.8f);
    // Too slow for the former 0.032 V/s release gate, but a real net recovery.
    for (int i = 1; i <= 160; i++) t.frame(2.8f + i * .0005f);
    assert(t.presses == 1 && t.releases == 1);
    t.frame(2.6f); assert(t.presses == 2);
  }
  {
    Trace t; t.frame(3.0873f); t.frame(2.947f);
    t.hold(2.947f, 120000); // wall/held signal for 100 minutes
    assert(t.rearms == 1 && t.releases == 0 && t.presses == 1);
    assert(!t.detector.state().occupancyKnown && t.detector.state().rearmed);
    // A fresh real drop works without a release/reset/calibration click.
    t.frame(2.6f); assert(t.presses == 2);
  }
  {
    Trace t; t.frame(3); t.frame(2);
    for (int i = 0; i < 20000; i++) t.frame(2 + (i % 5) * .001f);
    assert(t.presses == 1 && t.stomps == 1 && t.releases == 0);
  }
  {
    Trace t; t.frame(3);
    for (int i = 0; i < 10000; i++) t.frame(3 - i * .00002f);
    assert(t.presses == 0 && t.releases == 0); // slow baseline drift is not stepping
    t.frame(2.5f); assert(t.presses == 1);
  }
  {
    Trace t; t.frame(3); t.frame(2.8f); t.frame(2.7f, 2000);
    assert(t.presses == 1 && t.releases == 0 && t.rearms == 1);
    t.frame(2.5f); assert(t.presses == 2); // gap did not itself count
    t.detector.recalibrate(); t.frame(2.5f); t.frame(2.3f);
    assert(t.detector.state().steps == 3);
  }
  {
    Trace t; t.frame(3); t.frame(2);
    assert(t.presses == 1 && t.stomps == 0); // pressed baseline goes out first
    t.frame(3); // even a one-frame impact is classified once before release
    assert(t.stomps == 1);
    t.hold(3, 10); assert(t.releases == 1 && t.stomps == 1);
  }
  {
    Trace t; t.frame(3); t.frame(2.8f);
    t.frame(3); t.frame(2.8f); t.frame(3); t.frame(2.8f);
    assert(t.releases == 0); // release debounce rejects bounce
    t.hold(3, 5); assert(t.presses == 1 && t.releases == 1);
  }
  {
    Trace t;
    PressureMatDetector::Config config; config.maxSampleGapMs = 3000;
    t.detector.configure(config);
    t.frame(3, 1000); t.frame(2.8f, 1000); t.frame(3, 1000); t.frame(3, 1000);
    assert(t.presses == 1 && t.releases == 1 && t.rearms == 0);
  }
  {
    Trace t; t.now = std::numeric_limits<uint32_t>::max() - 100;
    t.frame(3); t.frame(2.8f); t.hold(3, 5);
    assert(t.presses == 1 && t.releases == 1 && t.rearms == 0);
    t.frame(std::numeric_limits<float>::quiet_NaN());
    assert(t.presses == 1);
  }
  std::cout << "10 native detector trace scenarios passed\n";
}
