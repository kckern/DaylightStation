// The ONLY fabricated element in the layout harness: Player.jsx's outer shell
// div (one line in the real component). Everything below it — ReadalongScroller,
// ContentScroller, all SCSS — is the real production code under test.
import { forwardRef, useImperativeHandle, useRef } from 'react';
import ReadalongScroller from '../../../../frontend/src/modules/Player/renderers/ReadalongScroller.jsx';
import '../../../../frontend/src/modules/Player/styles/Player.scss';
import fixture from './fixtureData.js';

const StubPlayer = forwardRef(function StubPlayer({ play, clear, onProgress }, ref) {
  const rootRef = useRef(null);
  const media = () => rootRef.current?.querySelector('audio,video') || null;
  useImperativeHandle(ref, () => ({
    seek: (t) => { const el = media(); if (el) el.currentTime = t; },
    toggle: () => { const el = media(); if (!el) return; if (el.paused) el.play(); else el.pause(); },
    play: () => media()?.play(),
    pause: () => media()?.pause(),
    getCurrentTime: () => media()?.currentTime || 0,
    getDuration: () => media()?.duration || 0,
    getMediaElement: media,
  }));
  return (
    <div className="player default" ref={rootRef}>
      <ReadalongScroller
        contentId={play?.contentId}
        initialData={fixture}
        advance={clear}
        clear={clear}
        onProgress={onProgress}
      />
    </div>
  );
});

export default StubPlayer;
