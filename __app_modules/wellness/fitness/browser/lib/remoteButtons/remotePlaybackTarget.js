// remotePlaybackTarget — where a remote's Playback actions go: the fitness
// player registers its own controls while it is mounted (FitnessPlayer), and
// the remote-button runtime calls them. The newest registration wins; none
// registered means no player is open, and the press does nothing.
//   { playPause(), next(), previous(), volumeUp(), volumeDown(), id }
const targets = [];

export function registerPlaybackTarget(target) {
  targets.push(target);
  return () => {
    const i = targets.lastIndexOf(target);
    if (i >= 0) targets.splice(i, 1);
  };
}

export function getPlaybackTarget() {
  return targets[targets.length - 1] || null;
}
