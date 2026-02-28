// frontend/src/modules/Media/PlayerSwipeContainer.jsx
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Responsive container for Queue | NowPlaying | Devices.
 *
 * Mobile (<768px): Horizontal scroll-snap — swipe between 3 full-width pages.
 * Desktop (>=768px): 3-column CSS grid — all panels visible simultaneously.
 *
 * Props:
 * - onCollapse: () => void — called when user taps collapse handle or swipes down
 * - children: exactly 3 React elements (queue, nowPlaying, devices)
 */
const PAGE_NAMES = ['queue', 'now-playing', 'devices'];

const PlayerSwipeContainer = ({ onCollapse, visible, children }) => {
  const scrollRef = useRef(null);
  const logger = useMemo(() => getLogger().child({ component: 'PlayerSwipeContainer' }), []);
  const [activePage, setActivePage] = useState(1); // 0=queue, 1=now-playing, 2=devices

  // Scroll to center page (NowPlaying) on mount and whenever player mode becomes visible
  useEffect(() => {
    if (!visible) return;
    const el = scrollRef.current;
    if (!el) return;
    const page = el.children[1];
    if (page) page.scrollIntoView({ behavior: 'instant', inline: 'start' });
    setActivePage(1);
  }, [visible]);

  // Track active page via scroll position (mobile only)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollLeft = el.scrollLeft;
        const pageWidth = el.clientWidth;
        const page = Math.min(2, Math.max(0, Math.round(scrollLeft / pageWidth)));
        setActivePage(prev => {
          if (prev !== page) logger.debug('player.swipe', { page: PAGE_NAMES[page] });
          return page;
        });
        ticking = false;
      });
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToPage = useCallback((page) => {
    const el = scrollRef.current;
    if (!el || !el.children[page]) return;
    logger.debug('player.dot-tap', { page: PAGE_NAMES[page] });
    el.children[page].scrollIntoView({ behavior: 'smooth', inline: 'start' });
  }, [logger]);

  const childArray = React.Children.toArray(children);

  return (
    <div className="player-mode">
      {/* Collapse handle — mobile only */}
      <div className="player-collapse-handle" onClick={() => { logger.debug('player.collapse'); onCollapse(); }}>
        <div className="player-collapse-bar" />
      </div>

      {/* Swipe container (mobile) / Grid container (desktop) */}
      <div className="player-swipe-container" ref={scrollRef}>
        <div className="player-swipe-page player-swipe-page--queue">
          {childArray[0]}
        </div>
        <div className="player-swipe-page player-swipe-page--now-playing">
          {childArray[1]}
        </div>
        <div className="player-swipe-page player-swipe-page--devices">
          {childArray[2]}
        </div>
      </div>

      {/* Dot indicators — mobile only */}
      <div className="player-dots">
        {[0, 1, 2].map(i => (
          <button
            key={i}
            className={`player-dot ${i === activePage ? 'player-dot--active' : ''}`}
            onClick={() => scrollToPage(i)}
            aria-label={['Queue', 'Now Playing', 'Devices'][i]}
          />
        ))}
      </div>
    </div>
  );
};

export default PlayerSwipeContainer;
