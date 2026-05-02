export class Satellite {
  constructor({
    id,
    mediaPlayerEntity,
    area = null,
    allowedSkills = [],
    defaultVolume = null,
    defaultMediaClass = null,
  }) {
    if (!id || typeof id !== 'string') throw new Error('Satellite.id is required');
    if (!mediaPlayerEntity || typeof mediaPlayerEntity !== 'string') {
      throw new Error('Satellite.mediaPlayerEntity is required');
    }
    if (!Array.isArray(allowedSkills) || allowedSkills.length === 0) {
      throw new Error('Satellite.allowedSkills must be a non-empty list');
    }

    this.id = id;
    this.mediaPlayerEntity = mediaPlayerEntity;
    this.area = area;
    this.allowedSkills = Object.freeze([...allowedSkills]);
    this.defaultVolume = defaultVolume;
    this.defaultMediaClass = defaultMediaClass;
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
