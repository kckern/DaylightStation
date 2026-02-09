import React, { useState, useEffect, useCallback, useRef } from 'react';
import ContentScroller from './ContentScroller.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import { useCenterByWidest } from '../../lib/Player/useCenterByWidest.js';
import { getSingalongRenderer } from '../../lib/contentRenderers.jsx';

/**
 * SingalongScroller
 * ----------------
 * Wraps ContentScroller for singalong content (hymns, primary songs).
 *
 * Features:
 *  - Fetches data from /api/v1/item/singalong/{path}
 *  - Parses stanza content (array of stanzas, each an array of lines)
 *  - Applies style via CSS variables
 *  - Uses useCenterByWidest hook for text centering
 *  - Calculates yStartTime for scrolling based on duration/verses
 */
export function SingalongScroller({
  contentId,
  advance,
  clear,
  volume,
  playbackKeys,
  ignoreKeys,
  queuePosition,
  onPlaybackMetrics,
  onRegisterMediaAccess,
  seekToIntentSeconds,
  onSeekRequestConsumed,
  remountDiagnostics
}) {
  const [data, setData] = useState(null);
  const textRef = useRef(null);
  const renderer = getSingalongRenderer();
  const cssType = renderer.cssType;
  const wrapperClass = renderer.wrapperClass;

  useEffect(() => {
    if (!contentId) return;

    // Convert contentId to URL path segments for the info endpoint.
    // Handles any prefix: singalong:hymn/123, hymn:166, primary:42, etc.
    const path = contentId.includes(':')
      ? contentId.replace(':', '/')
      : contentId;

    DaylightAPI(`api/v1/info/${path}`).then(response => {
      setData(response);
    });
  }, [contentId]);

  // Center text by widest line
  useCenterByWidest(textRef, [data?.content?.data]);

  const parseContent = useCallback((contentData) => {
    if (!contentData?.data) return null;

    return (
      <div className={wrapperClass} ref={textRef}>
        {contentData.data.map((stanza, sIdx) => (
          <div key={`stanza-${sIdx}`} className="stanza">
            {stanza.map((line, lIdx) => (
              <p key={`line-${sIdx}-${lIdx}`} className="line">{line}</p>
            ))}
          </div>
        ))}
      </div>
    );
  }, [wrapperClass]);

  if (!data) return null;

  // Apply style as CSS variables
  const cssVars = {
    '--font-family': data.style?.fontFamily || 'serif',
    '--font-size': data.style?.fontSize || '1.4rem',
    '--text-align': data.style?.textAlign || 'center',
    '--background': data.style?.background || 'transparent',
    '--color': data.style?.color || 'inherit'
  };

  // Calculate yStartTime based on duration and verse count
  // If API doesn't provide duration (returns 0), fall back to default 15s
  // ContentScroller discovers real duration from the audio element's loadedmetadata event
  const verseCount = data.content?.data?.length || 1;
  const yStartTime = data.duration ? (data.duration / verseCount) / 1.8 : 15;

  // Process volume parameter (same logic as Hymns)
  const mainVolume = (() => {
    if (!volume) return 1; // default for singalong
    let processedVolume = parseFloat(volume);
    if (processedVolume < 1 && processedVolume > 0) {
      processedVolume = processedVolume * 100;
    }
    if (processedVolume === 1) {
      processedVolume = 100;
    }
    return processedVolume / 100;
  })();

  return (
    <div style={cssVars} data-visual-type={cssType} className="singalong-scroller">
      <ContentScroller
        key={`singalong-${contentId}`}
        type={cssType}
        title={data.title}
        assetId={contentId}
        subtitle={data.subtitle}
        mainMediaUrl={data.mediaUrl}
        mainVolume={mainVolume}
        contentData={data.content}
        parseContent={parseContent}
        onAdvance={advance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        yStartTime={yStartTime}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    </div>
  );
}

export default SingalongScroller;