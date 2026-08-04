import { deriveModuleDemands, moduleVerdict, rollUpLesson } from '#domains/school/surfaces/index.mjs';
import { TI86_SCHOOLCALC_CODEC_CAPABILITIES } from './Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from './Ti86SchoolCalcLimits.mjs';

const MODULE_REASON = /^module (\d+)\b/;

/**
 * Frozen `school.surface-profile/v1`-shaped baseline for the TI-86 codec
 * (spec §3.2/§6.2). Tasks 9/12 use this for `baseline: 'codec'` CLI/profile
 * repository labeling.
 */
export function ti86CodecBaselineProfile() {
  return Object.freeze({
    schema: 'school.surface-profile/v1',
    surfaceId: 'ti86-codec-baseline',
    family: 'schoolcalc',
    liveness: 'observed',
    capabilities: Object.freeze([
      ...TI86_SCHOOLCALC_CODEC_CAPABILITIES,
      'return.cable@1',
      'return.qr@1',
    ]),
  });
}

/**
 * Certification port wrapping `Ti86SchoolCalcCodec` (spec §7.1). Pure:
 * `certify(bundle, profile)` never throws for content that doesn't fit; it
 * only throws for malformed inputs (delegated to the codec's own guards).
 */
export class Ti86SurfaceCertification {
  #codec;

  constructor({ codec }) {
    if (!codec || typeof codec.supports !== 'function' || typeof codec.compile !== 'function') {
      throw new Error('Ti86SurfaceCertification requires a codec with supports()/compile()');
    }
    this.#codec = codec;
  }

  certify(bundle, profile) {
    const modules = bundle?.lesson?.modules ?? [];
    const report = translateProfile(profile);
    // The port strips return.* off the PROFILE side before it reaches the
    // codec (translateProfile — the codec has no concept of return
    // channels). BuildLearningLesson folds a lesson's declared
    // requiredCapabilities straight into bundle.capabilities, so a
    // lesson-declared `return.cable@1` shows up there too. Without a
    // matching strip on the bundle side, the codec's plain membership check
    // (supports()) sees a required return.* capability with nothing in its
    // stripped available set and rejects a bundle the profile actually
    // supports (F3, 2026-08-04 acceptance audit). Fix: gate supports() with
    // a shallow-cloned bundle whose capabilities exclude return.* — never
    // mutate the caller's bundle. compile() below is still handed the
    // ORIGINAL bundle: artifact identity (byte digest / artifactId) is
    // derived from the bundle passed to compile(), and must stay whatever
    // it already is for existing golden fixtures.
    const gatingBundle = Array.isArray(bundle?.capabilities)
      ? { ...bundle, capabilities: bundle.capabilities.filter((id) => !id.startsWith('return.')) }
      : bundle;

    const reasons = [];
    const support = this.#codec.supports(gatingBundle, report);
    reasons.push(...support.reasons);

    let hasTrackedReturnReason = false;
    modules.forEach((module, index) => {
      const demands = deriveModuleDemands({ module });
      if (demands.tracked && !profile.capabilities.some((id) => id.startsWith('return.'))) {
        reasons.push(`module ${index} tracked module requires a return channel; profile offers none`);
        hasTrackedReturnReason = true;
      }
    });

    let resource;
    let compileWarnings = [];
    if (support.compatible && !hasTrackedReturnReason) {
      try {
        // compile() re-runs the codec's own supports() check internally,
        // against whatever bundle/capabilities pair it is given. We must
        // hand it the ORIGINAL (unfiltered) bundle so artifact identity is
        // unaffected — so the capabilities report here has to be the
        // superset (`profile.capabilities`, return.* included) rather than
        // the stripped `report`, or that internal re-check would reject the
        // very bundle we just certified compatible above.
        const compileReport = { ...report, capabilities: profile.capabilities };
        const compiled = this.#codec.compile(bundle, compileReport);
        resource = {
          estimatedBytes: compiled.byteLength,
          limitsApplied: {
            hardCeilingBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes,
            targetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes,
          },
        };
        compileWarnings = compiled.warnings ?? [];
      } catch (error) {
        reasons.push(error.message);
      }
    }

    const moduleVerdicts = modules.map((module, index) => moduleVerdict({
      moduleId: module.moduleId,
      reasons: reasons.filter((reason) => {
        const match = MODULE_REASON.exec(reason);
        return match ? Number(match[1]) === index : true;
      }),
      warnings: compileWarnings,
    }));

    return {
      modules: moduleVerdicts,
      lesson: { verdict: rollUpLesson(moduleVerdicts, { fullOrNothing: true }) },
      ...(resource ? { resource } : {}),
    };
  }
}

/**
 * Profile → codec-report translation (spec §7.1): strip `return.*` before
 * handing capabilities to the codec, since the codec has no concept of
 * return channels; omit `maxArtifactBytes` when unset so the codec default
 * applies.
 */
function translateProfile(profile) {
  const limits = {};
  if (profile.limits?.maxArtifactBytes !== undefined) {
    limits.maxArtifactBytes = profile.limits.maxArtifactBytes;
  }
  return {
    platformId: 'ti86',
    capabilities: profile.capabilities.filter((id) => !id.startsWith('return.')),
    limits,
  };
}
