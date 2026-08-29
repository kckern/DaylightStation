const DEFAULT_VOLUME_STATE = Object.freeze({ volume: 70, muted: false });

function normalizedKeyboardId(value) {
  return value?.replace(/\s+/g, '').toLowerCase();
}

/** Application operations over persisted home-control state. */
export class HomeStateService {
  constructor({ repository, remoteExecGateway = null, weatherRepository = null }) {
    if (!repository) throw new Error('HomeStateService requires repository');
    this.repository = repository;
    this.remoteExecGateway = remoteExecGateway;
    this.weatherRepository = weatherRepository;
  }

  async controlVolume(level) {
    const beforeState = this.repository.loadVolumeState() || { ...DEFAULT_VOLUME_STATE };
    let { volume, muted } = beforeState;
    let result;
    const save = (state) => this.repository.saveVolumeState(state);
    const setVolume = (value) => this.remoteExecGateway.setVolume(value);

    if (level === 'mute') {
      save({ volume, muted: true });
      result = await setVolume('mute');
    } else if (level === 'unmute') {
      save({ volume, muted: false });
      result = await setVolume('unmute');
    } else if (level === 'togglemute') {
      if (muted) {
        save({ volume, muted: false });
        await setVolume('unmute');
        result = await setVolume(volume);
      } else {
        save({ volume, muted: true });
        result = await setVolume('mute');
      }
    } else {
      if (muted) {
        await setVolume('unmute');
        muted = false;
      }

      if (level === '+') {
        const nextLevel = Math.min(volume + 12, 100);
        save({ volume: nextLevel, muted });
        result = await setVolume(nextLevel);
      } else if (level === '-') {
        const nextLevel = Math.max(volume - 12, 0);
        save({ volume: nextLevel, muted });
        result = await setVolume(nextLevel);
      } else if (parseInt(level) === 0) {
        save({ volume: 0, muted: true });
        result = await setVolume('mute');
      } else if (!Number.isNaN(parseInt(level))) {
        save({ volume: parseInt(level), muted });
        result = await setVolume(parseInt(level));
      } else if (level === 'cycle') {
        const cycleLevels = [70, 50, 30, 20, 10, 0];
        const nextLevel = cycleLevels[(cycleLevels.indexOf(volume) + 1) % cycleLevels.length];
        save({ volume: nextLevel, muted });
        result = await setVolume(nextLevel);
      }
    }

    const afterState = this.repository.loadVolumeState() || { volume, muted };
    return { result, beforeState, afterState };
  }

  getKeyboard(keyboardId) {
    const wanted = normalizedKeyboardId(keyboardId);
    const matches = (this.repository.loadKeyboardBindings() || [])
      .filter((binding) => normalizedKeyboardId(binding.folder) === wanted);
    if (matches.length === 0) return { kind: 'not_found', keyboardId };
    const value = matches.reduce((result, binding) => {
      const { key, label, function: operation, params, secondary } = binding;
      if (key && operation) result[key] = { label, function: operation, params, secondary };
      return result;
    }, {});
    return { kind: 'found', value };
  }

  async getWeather() {
    return (await this.weatherRepository?.load?.()) || {};
  }

  getEvents() {
    return this.repository.loadEvents() || [];
  }
}

export default HomeStateService;
