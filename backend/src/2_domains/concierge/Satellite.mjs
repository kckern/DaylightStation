export class Satellite {
  constructor({
    id,
    mediaPlayerEntity,
    area = null,
    allowedSkills = [],
    defaultVolume = null,
    defaultMediaClass = null,
    scopes_allowed = [],
    scopes_denied = [],
    media_policy = null,
  }) {
    if (!id || typeof id !== 'string') throw new Error('Satellite.id is required');
    if (!mediaPlayerEntity || typeof mediaPlayerEntity !== 'string') {
      throw new Error('Satellite.mediaPlayerEntity is required');
    }
    if (!Array.isArray(allowedSkills) || allowedSkills.length === 0) {
      throw new Error('Satellite.allowedSkills must be a non-empty list');
    }
    if (!Array.isArray(scopes_allowed)) throw new Error('Satellite.scopes_allowed must be an array');
    if (!Array.isArray(scopes_denied)) throw new Error('Satellite.scopes_denied must be an array');
    if (media_policy !== null && (typeof media_policy !== 'object' || Array.isArray(media_policy))) {
      throw new Error('Satellite.media_policy must be an object or null');
    }

    this.id = id;
    this.mediaPlayerEntity = mediaPlayerEntity;
    this.area = area;
    this.allowedSkills = Object.freeze([...allowedSkills]);
    this.defaultVolume = defaultVolume;
    this.defaultMediaClass = defaultMediaClass;
    this.scopes_allowed = Object.freeze([...scopes_allowed]);
    this.scopes_denied = Object.freeze([...scopes_denied]);
    this.media_policy = media_policy ? deepFreeze(structuredClone(media_policy)) : null;
    Object.freeze(this);
  }

  canUseSkill(name) {
    return this.allowedSkills.includes(name);
  }

  mediaPlayerFor(_mediaClass = null) {
    return this.mediaPlayerEntity;
  }
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  for (const v of Object.values(obj)) deepFreeze(v);
  return Object.freeze(obj);
}

export default Satellite;
