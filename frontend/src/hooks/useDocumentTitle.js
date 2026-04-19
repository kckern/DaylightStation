import { useEffect } from 'react';

const SUFFIX = 'Daylight Station';

export default function useDocumentTitle(name) {
  useEffect(() => {
    const prev = document.title;
    document.title = name ? `${name} | ${SUFFIX}` : SUFFIX;
    return () => { document.title = prev; };
  }, [name]);
}
