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

    this.id = id;
    this.mediaPlayerEntity = mediaPlayerEntity;
    this.area = area;
    this.allowedSkills = Object.freeze([...allowedSkills]);
    this.defaultVolume = defaultVolume;
    this.defaultMediaClass = defaultMediaClass;
    this.scopes_allowed = Object.freeze([...scopes_allowed]);
    this.scopes_denied = Object.freeze([...scopes_denied]);
    Object.freeze(this);
  }

  canUseSkill(name) {
    return this.allowedSkills.includes(name);
  }

  mediaPlayerFor(_mediaClass = null) {
    return this.mediaPlayerEntity;
  }
}

export default Satellite;
