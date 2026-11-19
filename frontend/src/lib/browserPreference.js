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
