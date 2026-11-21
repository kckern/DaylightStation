// Raw string preferences retain their existing on-disk format. Features supply
// validation and legacy value migration through decode.
export function browserPreference(key, fallback, decode = value => value, getStorage = () => localStorage) {
  return {
    read() {
      try {
        const raw = getStorage().getItem(key);
        return raw === null ? fallback : decode(raw) ?? fallback;
      } catch {
        return fallback;
      }
    },
    clear() {
      try {
        getStorage().removeItem(key);
      } catch {
        // The feature can still clear its in-memory selection.
      }
    },
    write(value) {
      try {
        getStorage().setItem(key, value);
      } catch {
        // Private or full storage still allows the current view to work.
      }
    },
  };
}

// A notification can arrive after a newer write. Let the owner reread the key
// so its current value and fallback policy still come from one place.
export function subscribeToStorageKey(key, listener, getStorage = () => localStorage) {
  const onStorage = event => {
    if (event.key !== key && event.key !== null) return;
    let storage;
    try { storage = getStorage(); } catch { return; }
    if (storage && event.storageArea === storage) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
