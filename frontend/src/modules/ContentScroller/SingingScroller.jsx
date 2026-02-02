import React, { useState, useEffect, useCallback, useRef } from 'react';
import ContentScroller from './ContentScroller.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import { useCenterByWidest } from '../../lib/Player/useCenterByWidest.js';

/**
 * SingingScroller
 * ---------------
 * Wraps ContentScroller for singing content (hymns, primary songs).
 *
 * Features:
 *  - Fetches data from /api/v1/item/singing/{path}
 *  - Parses stanza content (array of stanzas, each an array of lines)
 *  - Applies style via CSS variables
 *  - Uses useCenterByWidest hook for text centering
 *  - Calculates yStartTime for scrolling based on duration/verses
 */
export function SingingScroller({
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

  useEffect(() => {
    if (!contentId) return;

    // Extract path from contentId (singing:hymn/123 → hymn/123)
    const path = contentId.replace(/^singing:/, '');

    DaylightAPI(`api/v1/item/singing/${path}`).then(response => {
      setData(response);
    });
  }, [contentId]);

  // Center text by widest line
  useCenterByWidest(textRef, [data?.content?.data]);

  const parseContent = useCallback((contentData) => {
    if (!contentData?.data) return null;

    return (
      <div className="singing-text" ref={textRef}>
        {contentData.data.map((stanza, sIdx) => (
          <div key={`stanza-${sIdx}`} className="stanza">
            {stanza.map((line, lIdx) => (
              <p key={`line-${sIdx}-${lIdx}`} className="line">{line}</p>
            ))}
          </div>
        ))}
      </div>
    );
  }, []);

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
  const verseCount = data.content?.data?.length || 1;
  const yStartTime = (data.duration / verseCount) / 1.8;

  // Process volume parameter (same logic as Hymns)
  const mainVolume = (() => {
    if (!volume) return 1; // default for singing
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
    <div style={cssVars} data-visual-type="singing" className="singing-scroller">
      <ContentScroller
        key={`singing-${contentId}`}
        type="singing"
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

export default SingingScroller;
