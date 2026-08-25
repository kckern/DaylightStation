import { useState } from 'react';

/**
 * An <img> that fails soft: a broken source renders the module's quiet
 * not-available copy instead of the browser's broken-image glyph.
 */
export default function SafeImg({ fallback = 'Preview not available', alt = '', ...rest }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback ? <p className="teacher-muted teacher-img-fallback">{fallback}</p> : null;
  return <img alt={alt} {...rest} onError={() => setFailed(true)} />;
}
