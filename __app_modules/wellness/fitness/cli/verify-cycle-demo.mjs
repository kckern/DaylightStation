import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
const observed = {
  cycleStarted: false,
  reachedRamp: false,
  reachedMaintain: false,
  progressAdvanced: false,
  reachedLocked: false,
  recovered: false,
  maxProgressSeen: 0,
  finalState: null
};

page.on('console', (m) => {
  const t = m.text();
  if (/cycle\.|state_transition|phase_advanced|locked|recovered/i.test(t)) {
    console.log('[browser]', t.slice(0, 200));
  }
});

console.log('navigating…');
await page.goto('http://localhost:3111/fitness/menu/app_menu1');
await page.waitForFunction(() => !!window.__fitnessSimController, null, { timeout: 30000 });
const card = page.locator('.module-card', { hasText: 'Cycle Challenge Demo' });
await card.click();
await page.waitForURL(/\/fitness\/play\/\d+\?.*cycle-demo=1/, { timeout: 20000 });
console.log('on player URL:', page.url());

const start = Date.now();
const deadline = start + 90000; // 90s window to see progression

while (Date.now() < deadline) {
  const state = await page.evaluate(() => {
    const g = window.__fitnessGovernance;
    return {
      cycleState: g?.cycleState,
      activeChallengeType: g?.activeChallengeType,
      currentRpm: g?.currentRpm,
      progress: g?.phaseProgressPct,
      phaseIdx: g?.currentPhaseIndex,
      totalPhases: g?.totalPhases,
      governancePhase: g?.phase,
      paused: window.__fitnessSession?.governanceEngine?.challengeState?.activeChallenge?._pausedAt != null
    };
  });
  if (state.activeChallengeType === 'cycle' && !observed.cycleStarted) {
    observed.cycleStarted = true;
    console.log(`+${((Date.now() - start) / 1000).toFixed(1)}s cycle STARTED`);
  }
  if (state.cycleState === 'ramp' && !observed.reachedRamp) {
    observed.reachedRamp = true;
    console.log(`+${((Date.now() - start) / 1000).toFixed(1)}s reached RAMP`);
  }
  if (state.cycleState === 'maintain' && !observed.reachedMaintain) {
    observed.reachedMaintain = true;
    console.log(`+${((Date.now() - start) / 1000).toFixed(1)}s reached MAINTAIN`);
  }
  if (state.cycleState === 'locked' && !observed.reachedLocked) {
    observed.reachedLocked = true;
    console.log(`+${((Date.now() - start) / 1000).toFixed(1)}s reached LOCKED`);
  }
  if (state.progress > observed.maxProgressSeen) {
    observed.maxProgressSeen = state.progress;
    console.log(`+${((Date.now() - start) / 1000).toFixed(1)}s progress = ${state.progress}%, state=${state.cycleState}, rpm=${state.currentRpm}, phase=${state.phaseIdx}`);
  }
  if (state.progress > 0 && !observed.progressAdvanced) {
    observed.progressAdvanced = true;
  }
  observed.finalState = state;
  await page.waitForTimeout(500);
}

console.log('\n=== RESULT ===');
console.log(JSON.stringify(observed, null, 2));
await browser.close();

if (!observed.cycleStarted) { console.error('FAIL: cycle never started'); process.exit(1); }
if (!observed.reachedRamp) { console.error('FAIL: never reached RAMP'); process.exit(1); }
if (!observed.reachedMaintain) { console.error('FAIL: never reached MAINTAIN'); process.exit(1); }
if (!observed.progressAdvanced) { console.error('FAIL: phase progress never advanced past 0'); process.exit(1); }
console.log('PASS');
