import crypto from 'node:crypto';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export class Sha1ContentFingerprint {
  hash(value) { return crypto.createHash('sha1').update(stableStringify(value)).digest('hex'); }
}

export default Sha1ContentFingerprint;
