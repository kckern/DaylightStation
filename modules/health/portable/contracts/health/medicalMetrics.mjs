/** Display/validation vocabulary only; no diagnosis or unit conversion. */
export const MEDICAL_METRICS = Object.freeze({
  bp: { label: 'Blood Pressure', units: ['mmHg'], paired: true },
  resting_hr: { label: 'Resting Heart Rate', units: ['bpm'] },
  glucose: { label: 'Glucose', units: ['mg/dL', 'mmol/L'] },
  a1c: { label: 'A1C', units: ['%', 'mmol/mol'] },
  cholesterol_total: { label: 'Total Cholesterol', units: ['mg/dL', 'mmol/L'] },
  ldl: { label: 'LDL', units: ['mg/dL', 'mmol/L'] },
  hdl: { label: 'HDL', units: ['mg/dL', 'mmol/L'] },
  triglycerides: { label: 'Triglycerides', units: ['mg/dL', 'mmol/L'] },
});
