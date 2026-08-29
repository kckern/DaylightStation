/** Runtime owned by infrastructure for one logical livestream channel. */
export function assertStreamChannelRuntime(runtime) {
  const required = ['dispose', 'play', 'stopSource', 'playSilence', 'playAmbientLoop', 'openListener'];
  for (const method of required) {
    if (typeof runtime?.[method] !== 'function') {
      throw new Error(`Stream channel runtime requires ${method}()`);
    }
  }
  return runtime;
}

export function assertStreamChannelRuntimeFactory(factory) {
  if (typeof factory !== 'function') throw new Error('ChannelManager requires createChannelRuntime');
  return factory;
}
