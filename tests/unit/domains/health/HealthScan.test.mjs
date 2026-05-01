import { describe, it, expect } from 'vitest';
import HealthScanDefault, { HealthScan } from '../../../../backend/src/2_domains/health/entities/HealthScan.mjs';

const validRequired = () => ({
  date: '2024-01-15',
  source: 'bodyspec_dexa',
  device_type: 'DEXA',
  weight_lbs: 175.0,
  body_fat_percent: 22.0,
  lean_tissue_lbs: 130.0,
  fat_tissue_lbs: 38.5,
});

describe('HealthScan', () => {
  it('constructs with required fields (date, source, device_type, weight_lbs, body_fat_percent, lean_tissue_lbs, fat_tissue_lbs)', () => {
    const scan = new HealthScan(validRequired());
    expect(scan.date).toBe('2024-01-15');
    expect(scan.source).toBe('bodyspec_dexa');
    expect(scan.deviceType).toBe('DEXA');
    expect(scan.weightLbs).toBe(175.0);
    expect(scan.bodyFatPercent).toBe(22.0);
    expect(scan.leanTissueLbs).toBe(130.0);
    expect(scan.fatTissueLbs).toBe(38.5);
  });

  it('rejects invalid source (must be inbody / bodyspec_dexa / other)', () => {
    expect(() => new HealthScan({ ...validRequired(), source: 'fitbit' })).toThrow(/source/);
    expect(() => new HealthScan({ ...validRequired(), source: 'INBODY' })).toThrow(/source/);
    // sanity: valid sources accepted
    expect(() => new HealthScan({ ...validRequired(), source: 'inbody', device_type: 'clinical_BIA' })).not.toThrow();
    expect(() => new HealthScan({ ...validRequired(), source: 'other', device_type: 'consumer_BIA' })).not.toThrow();
  });

  it('rejects invalid device_type (must be clinical_BIA / DEXA / consumer_BIA)', () => {
    expect(() => new HealthScan({ ...validRequired(), device_type: 'scale' })).toThrow(/device_type/);
    expect(() => new HealthScan({ ...validRequired(), device_type: 'dexa' })).toThrow(/device_type/);
    // sanity: valid device types accepted
    expect(() => new HealthScan({ ...validRequired(), source: 'inbody', device_type: 'clinical_BIA' })).not.toThrow();
    expect(() => new HealthScan({ ...validRequired(), source: 'other', device_type: 'consumer_BIA' })).not.toThrow();
  });

  it('rejects missing required fields with descriptive error', () => {
    const fields = ['date', 'source', 'device_type', 'weight_lbs', 'body_fat_percent', 'lean_tissue_lbs', 'fat_tissue_lbs'];
    for (const field of fields) {
      const raw = validRequired();
      delete raw[field];
      expect(() => new HealthScan(raw), `missing ${field}`).toThrow(new RegExp(field));
    }
    // also rejects null/undefined input
    expect(() => new HealthScan(null)).toThrow(/HealthScan/);
    expect(() => new HealthScan(undefined)).toThrow(/HealthScan/);
    expect(() => new HealthScan('not-an-object')).toThrow(/HealthScan/);
  });

  it('body_fat_percent must be in [0, 60]', () => {
    expect(() => new HealthScan({ ...validRequired(), body_fat_percent: -1 })).toThrow(/body_fat_percent/);
    expect(() => new HealthScan({ ...validRequired(), body_fat_percent: 60 })).toThrow(/body_fat_percent/);
    expect(() => new HealthScan({ ...validRequired(), body_fat_percent: 75 })).toThrow(/body_fat_percent/);
    expect(() => new HealthScan({ ...validRequired(), body_fat_percent: NaN })).toThrow(/body_fat_percent/);
    // boundaries: 0 ok, just-under-60 ok
    expect(new HealthScan({ ...validRequired(), body_fat_percent: 0 }).bodyFatPercent).toBe(0);
    expect(new HealthScan({ ...validRequired(), body_fat_percent: 59.9 }).bodyFatPercent).toBe(59.9);
  });

  it('lean_tissue_lbs must be > 0', () => {
    expect(() => new HealthScan({ ...validRequired(), lean_tissue_lbs: 0 })).toThrow(/lean_tissue_lbs/);
    expect(() => new HealthScan({ ...validRequired(), lean_tissue_lbs: -10 })).toThrow(/lean_tissue_lbs/);
    expect(() => new HealthScan({ ...validRequired(), lean_tissue_lbs: 'heavy' })).toThrow(/lean_tissue_lbs/);
    expect(() => new HealthScan({ ...validRequired(), lean_tissue_lbs: Infinity })).toThrow(/lean_tissue_lbs/);
  });

  it('weight_lbs must be > 0', () => {
    expect(() => new HealthScan({ ...validRequired(), weight_lbs: 0 })).toThrow(/weight_lbs/);
    expect(() => new HealthScan({ ...validRequired(), weight_lbs: -150 })).toThrow(/weight_lbs/);
    expect(() => new HealthScan({ ...validRequired(), weight_lbs: 'one-seventy-five' })).toThrow(/weight_lbs/);
    expect(() => new HealthScan({ ...validRequired(), weight_lbs: NaN })).toThrow(/weight_lbs/);
  });

  it('bmr_method must be measured / katch_mcardle / estimated when bmr_kcal present (otherwise optional)', () => {
    // bmr_kcal present + invalid bmr_method => throw
    expect(
      () => new HealthScan({ ...validRequired(), bmr_kcal: 1700, bmr_method: 'guess' })
    ).toThrow(/bmr_method/);
    // bmr_kcal present + missing bmr_method => throw
    expect(
      () => new HealthScan({ ...validRequired(), bmr_kcal: 1700 })
    ).toThrow(/bmr_method/);
    // bmr_kcal absent + bmr_method absent => OK
    expect(() => new HealthScan(validRequired())).not.toThrow();
    // bmr_kcal present + valid bmr_method => OK
    const ok = new HealthScan({ ...validRequired(), bmr_kcal: 1700, bmr_method: 'katch_mcardle' });
    expect(ok.bmrKcal).toBe(1700);
    expect(ok.bmrMethod).toBe('katch_mcardle');
  });

  it('optional fields preserved when present and absent from serialize() when null/undefined', () => {
    const scan = new HealthScan({
      ...validRequired(),
      bone_mineral_content_lbs: 6.5,
      bmr_kcal: 1700,
      bmr_method: 'katch_mcardle',
      visceral_fat_lbs: 0.7,
      bone_density_z_score: 1.1,
      notes: 'some notes',
      raw_pdf_path: '/p/x.pdf',
      raw_image_path: '/p/x.jpg',
    });
    const ser = scan.serialize();
    expect(ser.bone_mineral_content_lbs).toBe(6.5);
    expect(ser.bmr_kcal).toBe(1700);
    expect(ser.bmr_method).toBe('katch_mcardle');
    expect(ser.visceral_fat_lbs).toBe(0.7);
    expect(ser.bone_density_z_score).toBe(1.1);
    expect(ser.notes).toBe('some notes');
    expect(ser.raw_pdf_path).toBe('/p/x.pdf');
    expect(ser.raw_image_path).toBe('/p/x.jpg');

    // Bare scan: optional fields omitted
    const bare = new HealthScan(validRequired());
    const bareSer = bare.serialize();
    expect('bone_mineral_content_lbs' in bareSer).toBe(false);
    expect('bmr_kcal' in bareSer).toBe(false);
    expect('bmr_method' in bareSer).toBe(false);
    expect('visceral_fat_lbs' in bareSer).toBe(false);
    expect('bone_density_z_score' in bareSer).toBe(false);
    expect('asymmetry' in bareSer).toBe(false);
    expect('regional' in bareSer).toBe(false);
    expect('notes' in bareSer).toBe(false);
    expect('raw_pdf_path' in bareSer).toBe(false);
    expect('raw_image_path' in bareSer).toBe(false);

    // Empty strings treated as undefined
    const emptyStrings = new HealthScan({ ...validRequired(), notes: '', raw_pdf_path: '', raw_image_path: '' });
    const empSer = emptyStrings.serialize();
    expect('notes' in empSer).toBe(false);
    expect('raw_pdf_path' in empSer).toBe(false);
    expect('raw_image_path' in empSer).toBe(false);
  });

  it('asymmetry and regional accepted as plain objects, passed through', () => {
    const scan = new HealthScan({
      ...validRequired(),
      asymmetry: { left_arm_lean_lbs: 7.2, right_arm_lean_lbs: 7.4 },
      regional: { trunk_fat_percent: 21.0, legs_fat_percent: 19.0 },
    });
    expect(scan.asymmetry).toEqual({ left_arm_lean_lbs: 7.2, right_arm_lean_lbs: 7.4 });
    expect(scan.regional).toEqual({ trunk_fat_percent: 21.0, legs_fat_percent: 19.0 });
    const ser = scan.serialize();
    expect(ser.asymmetry).toEqual({ left_arm_lean_lbs: 7.2, right_arm_lean_lbs: 7.4 });
    expect(ser.regional).toEqual({ trunk_fat_percent: 21.0, legs_fat_percent: 19.0 });

    // Reject non-object (array / scalar)
    expect(() => new HealthScan({ ...validRequired(), asymmetry: [1, 2, 3] })).toThrow(/asymmetry/);
    expect(() => new HealthScan({ ...validRequired(), regional: 'left side' })).toThrow(/regional/);
  });

  it('serialize() returns the original snake_case shape ready for YAML write', () => {
    const raw = {
      date: '2024-01-15',
      source: 'bodyspec_dexa',
      device_type: 'DEXA',
      weight_lbs: 175.0,
      body_fat_percent: 22.0,
      lean_tissue_lbs: 130.0,
      fat_tissue_lbs: 38.5,
      bone_mineral_content_lbs: 6.5,
      bmr_kcal: 1700,
      bmr_method: 'katch_mcardle',
      visceral_fat_lbs: 0.7,
      bone_density_z_score: 1.1,
      asymmetry: { left_arm_lean_lbs: 7.2, right_arm_lean_lbs: 7.4 },
      regional: { trunk_fat_percent: 21.0, legs_fat_percent: 19.0 },
      notes: 'Synthetic fixture for tests.',
      raw_pdf_path: '/placeholder/2024-01-15-dexa.pdf',
      raw_image_path: '/placeholder/2024-01-15-dexa.jpg',
    };
    const scan = new HealthScan(raw);
    expect(scan.serialize()).toEqual(raw);
  });

  it('default export present', () => {
    expect(HealthScanDefault).toBe(HealthScan);
  });
});
