// Raw string preferences retain their existing on-disk format. Features supply
// validation and legacy value migration through decode.
export function browserPreference(key, fallback, decode = value => value) {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : decode(raw) ?? fallback;
      } catch {
        return fallback;
      }
    },
    write(value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Private or full storage still allows the current view to work.
      }
    },
  };
}
