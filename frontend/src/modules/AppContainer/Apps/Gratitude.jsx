import { MantineProvider } from "@mantine/core";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { WebSocketProvider, useWebSocket } from "../../../contexts/WebSocketContext.jsx";
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { DaylightAPI, DaylightMediaPath } from '../../../lib/api.mjs';
import { isToday, format } from 'date-fns';
import "./Gratitude.scss";
import thanksIcon from "../../../assets/icons/thanks.svg";
import hopesIcon from "../../../assets/icons/hopes.svg";

const logger = getChildLogger('gratitude');

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get avatar URL for a user
 */
const getAvatarSrc = (userId) => {
  return DaylightMediaPath(`/media/img/users/${userId || 'user'}`);
};

const getFallbackAvatarSrc = () => {
  return DaylightMediaPath('/media/img/users/user');
};

/**
 * Get user display label (prefer group_label over display_name)
 */
const getUserLabel = (user) => {
  return user?.group_label || user?.name || user?.id || '?';
};

/**
 * Format date for display: blank if today, "DD Mon" if past
 */
const formatItemDate = (datetime) => {
  if (!datetime) return '';
  const date = new Date(datetime);
  if (isToday(date)) return '';
  return format(date, 'd MMM');
};

/**
 * Split items into today vs past
 */
const splitByToday = (items) => {
  const today = [];
  const past = [];
  
  for (const item of items) {
    if (!item.datetime) {
      today.push({ ...item, dateLabel: '' });
      continue;
    }
    const itemDate = new Date(item.datetime);
    if (isToday(itemDate)) {
      today.push({ ...item, dateLabel: '' });
    } else {
      past.push({ ...item, dateLabel: format(itemDate, 'd MMM') });
    }
  }
  
  return { today, past };
};

// ============================================================================
// GratitudeHeader Component
// ============================================================================

function GratitudeHeader({ 
  category, 
  currentUser, 
  users, 
  focused, 
  headerFocus, 
  onCategoryChange, 
  onUserChange,
  onHeaderFocusChange,
  categoryAnim,
  userAnim,
  onCategoryCycle,
  onUserCycle
}) {
  const handleImageError = (event) => {
    const img = event.currentTarget;
    if (img.dataset.fallback) {
      img.style.display = 'none';
      return;
    }
    img.dataset.fallback = '1';
    img.src = getFallbackAvatarSrc();
  };

  return (
    <div className={`gratitude-header ${focused ? 'header-focused' : ''}`}>
      <div 
        className={`category-cycle ${focused && headerFocus === 'category' ? 'focused' : ''}`}
        onClick={() => onCategoryCycle('next')}
      >
        <span className="cycle-arrow up">▲</span>
        <div className={`cycle-content ${categoryAnim ? `slide-${categoryAnim}` : ''}`}>
          <img 
            src={category === 'gratitude' ? thanksIcon : hopesIcon} 
            alt="" 
            className="category-icon"
          />
          <span className="cycle-label">{category === 'gratitude' ? 'Gratitude' : 'Hopes'}</span>
        </div>
        <span className="cycle-arrow down">▼</span>
      </div>
      
      <div 
        className={`user-cycle ${focused && headerFocus === 'user' ? 'focused' : ''}`}
        onClick={() => onUserCycle('next')}
      >
        <span className="cycle-arrow up">▲</span>
        <div className={`cycle-content ${userAnim ? `slide-${userAnim}` : ''}`}>
          <div className="user-avatar-small">
            <img 
              src={getAvatarSrc(currentUser?.id)} 
              alt="" 
              onError={handleImageError}
            />
          </div>
          <span className="cycle-label">{getUserLabel(currentUser)}</span>
        </div>
        <span className="cycle-arrow down">▼</span>
      </div>
    </div>
  );
}

// ============================================================================
// QueueColumn Component
// ============================================================================

function QueueColumn({ 
  items, 
  category,
  focused, 
  animatingItem, 
  animationDirection,
  newlyAddedItem,
  currentUser,
  sessionDiscarded
}) {
  const categoryLabel = category === 'gratitude' ? 'Gratitude' : 'Hopes';
  
  // Combine queue items with session discarded at bottom
  const allItems = [...items, ...sessionDiscarded];
  const totalCount = allItems.length;
  
  const handleImageError = (event) => {
    const img = event.currentTarget;
    if (img.dataset.fallback) {
      img.style.display = 'none';
      return;
    }
    img.dataset.fallback = '1';
    img.src = getFallbackAvatarSrc();
  };
  
  return (
    <div className={`gratitude-column queue-column ${focused ? 'column-focused' : ''}`}>
      <div className="column-header">
        <h3>
          {categoryLabel} Ideas
          <span className="count-badge">{totalCount}</span>
        </h3>
      </div>
      <div className="column-content">
        {allItems.length === 0 ? (
          <div className="empty-column">All done!</div>
        ) : (
          allItems.map((item, index) => {
            let itemClass = 'queue-item';
            
            // Mark discarded items
            if (item.discarded) {
              itemClass += ' discarded';
            }
            
            // Only the first item (index 0) can be focused
            if (focused && index === 0) {
              itemClass += ' focused';
            }
            
            // Sliding animation when being moved (only for top item)
            if (animatingItem?.id === item.id && index === 0) {
              if (animationDirection === 'left') {
                itemClass += ' sliding-left';
              } else if (animationDirection === 'right') {
                itemClass += ' sliding-right';
              }
            }
            
            // Slide-in animation for items returned from selections
            if (newlyAddedItem?.item?.id === item.id && newlyAddedItem?.column === 'queue') {
              itemClass += ' slide-in-to-queue';
            }
            
            return (
              <div key={item.id} className={itemClass}>
                <span className="item-text">{item.text}</span>
                {index === 0 && currentUser && (
                  <div className="queue-user-avatar">
                    <img 
                      src={getAvatarSrc(currentUser.id)} 
                      alt="" 
                      onError={handleImageError}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SelectedColumn Component
// ============================================================================

function SelectedColumn({ 
  items, 
  category,
  onCategoryChange,
  gratitudeCount,
  hopesCount,
  focused, 
  focusIndex,
  newlyAddedItem,
  webhookHighlightIds,
  animatingItem,
  animationDirection
}) {
  const { today, past } = splitByToday(items);
  const hasDivider = today.length > 0 && past.length > 0;
  const contentRef = useRef(null);
  
  // Auto-scroll to focused item
  useEffect(() => {
    if (focused && contentRef.current && focusIndex >= 0) {
      const focusedElement = contentRef.current.querySelector('.selected-item.focused');
      if (focusedElement) {
        focusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [focused, focusIndex]);
  
  const handleImageError = (event) => {
    const img = event.currentTarget;
    if (img.dataset.fallback) {
      img.style.display = 'none';
      return;
    }
    img.dataset.fallback = '1';
    img.src = getFallbackAvatarSrc();
  };
  
  let itemIndex = -1;
  
  const renderItem = (item, isPast = false) => {
    itemIndex++;
    const currentIndex = itemIndex;
    
    let itemClass = 'selected-item';
    if (isPast) itemClass += ' past';
    if (focused && currentIndex === focusIndex) itemClass += ' focused';
    if (webhookHighlightIds?.has(item.id)) itemClass += ' webhook-highlight';
    if (newlyAddedItem?.item?.id === item.id && newlyAddedItem?.column === 'selected') {
      itemClass += ' slide-in-from-right';
    }
    
    // Animation for deselecting (sliding left back to queue)
    if (animatingItem?.id === item.id && animationDirection === 'deselect-left') {
      itemClass += ' sliding-left-deselect';
    }
    
    return (
      <div key={item.id} className={itemClass}>
        <div className="user-avatar">
          <img 
            src={getAvatarSrc(item.userId)} 
            alt="" 
            onError={handleImageError}
          />
        </div>
        <span className="item-text">{item.text}</span>
        {isPast && item.dateLabel && (
          <span className="date-label">{item.dateLabel}</span>
        )}
      </div>
    );
  };

  return (
    <div className={`gratitude-column selected-column ${focused ? 'column-focused' : ''}`}>
      <div className="column-header tabbed-header">
        <div 
          className={`tab ${category === 'gratitude' ? 'active' : ''}`}
          onClick={() => onCategoryChange('gratitude')}
        >
          <img src={thanksIcon} alt="" className="tab-icon" />
          <span className="tab-label">Gratitude</span>
          <span className="count-badge">{gratitudeCount}</span>
        </div>
        <div 
          className={`tab ${category === 'hopes' ? 'active' : ''}`}
          onClick={() => onCategoryChange('hopes')}
        >
          <img src={hopesIcon} alt="" className="tab-icon" />
          <span className="tab-label">Hopes</span>
          <span className="count-badge">{hopesCount}</span>
        </div>
      </div>
      <div className="column-content" ref={contentRef}>
        {items.length === 0 ? (
          <div className="empty-column">—</div>
        ) : (
          <>
            {today.map(item => renderItem(item, false))}
            {hasDivider && <div className="past-divider" />}
            {past.map(item => renderItem(item, true))}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main GratitudeApp Component (with WebSocket)
// ============================================================================

function GratitudeApp({ 
  users, 
  initialQueue, 
  initialSelected, 
  onExit 
}) {
  // UI State
  const [category, setCategory] = useState('gratitude');
  const [currentUser, setCurrentUser] = useState(users[0] || null);
  const [focusZone, setFocusZone] = useState('queue'); // 'header' | 'queue' | 'selected'
  const [focusIndex, setFocusIndex] = useState(0);
  const [headerFocus, setHeaderFocus] = useState('category'); // 'category' | 'user'
  
  // Data State
  const [queue, setQueue] = useState(initialQueue);
  const [selected, setSelected] = useState(initialSelected);
  const [sessionDiscarded, setSessionDiscarded] = useState({ gratitude: [], hopes: [] }); // Items dismissed this session (shown at bottom of queue)
  
  // Animation State
  const [animatingItem, setAnimatingItem] = useState(null);
  const [animationDirection, setAnimationDirection] = useState(null);
  const [newlyAddedItem, setNewlyAddedItem] = useState(null);
  const [webhookHighlightIds, setWebhookHighlightIds] = useState(new Set());
  const [categoryAnim, setCategoryAnim] = useState(null);
  const [userAnim, setUserAnim] = useState(null);
  
  const containerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const animatingRef = useRef(false); // Ref to track animation state for callbacks
  
  // WebSocket integration
  const { registerPayloadCallback, unregisterPayloadCallback } = useWebSocket();

  // Focus container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Reset focus index when category changes
  useEffect(() => {
    setFocusIndex(0);
  }, [category]);

  // =========================================================================
  // WebSocket Handler
  // =========================================================================
  
  const handleWebSocketPayload = useCallback((payload) => {
    if (payload.topic !== 'gratitude') return;
    if (payload.action !== 'item_added') return;
    
    const { items, userId, userName, category: itemCategory } = payload;
    
    logger.info('gratitude.websocket.received', { 
      count: items?.length, 
      userId, 
      category: itemCategory 
    });
    
    // 1. Auto-switch to the incoming category
    if (itemCategory && (itemCategory === 'gratitude' || itemCategory === 'hopes')) {
      setCategory(itemCategory);
    }
    
    // 2. Auto-switch to the incoming user
    const incomingUser = users.find(u => u.id === userId);
    if (incomingUser) {
      setCurrentUser(incomingUser);
    }
    
    // 3. Add items directly to selected with timestamps
    const now = new Date().toISOString();
    const newItems = items.map(item => ({
      id: item.id || crypto.randomUUID(),
      text: item.text,
      userId,
      userName,
      datetime: now,
    }));
    
    setSelected(prev => ({
      ...prev,
      [itemCategory]: [...newItems, ...(prev[itemCategory] || [])]
    }));
    
    // 4. Track webhook highlight IDs
    const newIds = new Set(newItems.map(i => i.id));
    setWebhookHighlightIds(prev => new Set([...prev, ...newIds]));
    
    // 5. Clear highlight after animation
    setTimeout(() => {
      setWebhookHighlightIds(prev => {
        const updated = new Set(prev);
        newIds.forEach(id => updated.delete(id));
        return updated;
      });
    }, 4000);
    
    // 6. Persist to backend
    newItems.forEach(item => {
      DaylightAPI(`/api/gratitude/selections/${itemCategory}`, {
        userId,
        item: { id: item.id, text: item.text }
      }, 'POST').catch(err => {
        logger.error('gratitude.websocket.persist.failed', { error: err.message });
      });
    });
    
  }, [users]);

  useEffect(() => {
    registerPayloadCallback(handleWebSocketPayload);
    return () => unregisterPayloadCallback();
  }, [registerPayloadCallback, unregisterPayloadCallback, handleWebSocketPayload]);

  // =========================================================================
  // Action Handlers
  // =========================================================================
  
  const handleSelect = useCallback(async (item) => {
    if (animatingRef.current) return;
    
    animatingRef.current = true;
    setAnimatingItem(item);
    setAnimationDirection('right');
    
    setTimeout(async () => {
      // Remove from queue
      setQueue(prev => ({
        ...prev,
        [category]: prev[category].filter(i => i.id !== item.id)
      }));
      
      // Also remove from sessionDiscarded if it was there
      if (item.discarded) {
        setSessionDiscarded(prev => ({
          ...prev,
          [category]: prev[category].filter(i => i.id !== item.id)
        }));
      }
      
      // Add to selected with current user
      const newSelection = {
        id: crypto.randomUUID(),
        text: item.text,
        itemId: item.id,
        userId: currentUser?.id,
        userName: getUserLabel(currentUser),
        datetime: new Date().toISOString(),
      };
      
      setSelected(prev => ({
        ...prev,
        [category]: [newSelection, ...(prev[category] || [])]
      }));
      
      // Clear animation
      animatingRef.current = false;
      setAnimatingItem(null);
      setAnimationDirection(null);
      setNewlyAddedItem({ item: newSelection, column: 'selected' });
      setTimeout(() => setNewlyAddedItem(null), 300);
      
      // Persist to backend
      try {
        const response = await DaylightAPI(`/api/gratitude/selections/${category}`, {
          userId: currentUser?.id,
          item: { id: item.id, text: item.text }
        }, 'POST');
        
        // Update with server-confirmed ID
        if (response?.selection?.id) {
          setSelected(prev => ({
            ...prev,
            [category]: prev[category].map(s => 
              s.itemId === item.id ? { ...s, id: response.selection.id } : s
            )
          }));
        }
      } catch (err) {
        logger.error('gratitude.select.failed', { error: err.message });
      }
    }, 300);
  }, [category, currentUser]);

  const handleDismiss = useCallback(async (item) => {
    if (animatingRef.current) return;
    
    animatingRef.current = true;
    setAnimatingItem(item);
    setAnimationDirection('left');
    
    // Use a slightly shorter timeout than animation duration to allow quicker chaining
    setTimeout(async () => {
      if (item.discarded) {
        // Item is already discarded - remove from sessionDiscarded and re-add at end
        setSessionDiscarded(prev => ({
          ...prev,
          [category]: [...prev[category].filter(i => i.id !== item.id), { ...item, discarded: true }]
        }));
      } else {
        // Remove from queue
        setQueue(prev => ({
          ...prev,
          [category]: prev[category].filter(i => i.id !== item.id)
        }));
        
        // Add to session discarded (will show at bottom of queue)
        setSessionDiscarded(prev => ({
          ...prev,
          [category]: [...prev[category], { ...item, discarded: true }]
        }));
        
        // Persist to backend (only for first-time discards)
        try {
          await DaylightAPI(`/api/gratitude/discarded/${category}`, { item }, 'POST');
        } catch (err) {
          logger.error('gratitude.dismiss.failed', { error: err.message });
        }
      }
      
      // Clear animation immediately so next dismiss can start
      animatingRef.current = false;
      setAnimatingItem(null);
      setAnimationDirection(null);
    }, 250); // Slightly less than CSS animation (300ms) to allow chaining
  }, [category]);

  const handleRemove = useCallback(async (selection) => {
    if (animatingRef.current) return;
    
    animatingRef.current = true;
    setAnimatingItem(selection);
    setAnimationDirection('deselect-left');
    
    setTimeout(async () => {
      // Remove from selected and add back to top of queue
      setSelected(prev => ({
        ...prev,
        [category]: prev[category].filter(s => s.id !== selection.id)
      }));
      
      // Add the item back to the top of the queue
      const itemToReturn = {
        id: selection.itemId || selection.id,
        text: selection.text,
      };
      
      setQueue(prev => ({
        ...prev,
        [category]: [itemToReturn, ...(prev[category] || [])]
      }));
      
      // Clear animation
      animatingRef.current = false;
      setAnimatingItem(null);
      setAnimationDirection(null);
      
      // Show slide-in animation on queue
      setNewlyAddedItem({ item: itemToReturn, column: 'queue' });
      setTimeout(() => setNewlyAddedItem(null), 300);
      
      // Adjust focus index if needed
      const remainingSelected = (selected[category] || []).length - 1;
      if (focusIndex >= remainingSelected && remainingSelected > 0) {
        setFocusIndex(remainingSelected - 1);
      } else if (remainingSelected === 0) {
        // No more selected items, move focus to queue
        setFocusZone('queue');
      }
      
      // Persist removal to backend
      try {
        await DaylightAPI(`/api/gratitude/selections/${category}/${selection.id}`, {}, 'DELETE');
      } catch (err) {
        logger.error('gratitude.remove.failed', { error: err.message });
      }
    }, 300);
  }, [category, selected, focusIndex]);

  // =========================================================================
  // Cycle Handlers (for header click events)
  // =========================================================================
  
  const handleCategoryCycle = useCallback((direction) => {
    const categories = ['gratitude', 'hopes'];
    const currentIndex = categories.indexOf(category);
    const nextIndex = direction === 'next' 
      ? (currentIndex + 1) % categories.length
      : (currentIndex - 1 + categories.length) % categories.length;
    
    setCategoryAnim(direction === 'next' ? 'up' : 'down');
    setTimeout(() => setCategoryAnim(null), 300);
    setCategory(categories[nextIndex]);
  }, [category]);
  
  const handleUserCycle = useCallback((direction) => {
    if (!users.length || !currentUser) return;
    const currentIndex = users.findIndex(u => u.id === currentUser.id);
    const nextIndex = direction === 'next' 
      ? (currentIndex + 1) % users.length
      : (currentIndex - 1 + users.length) % users.length;
    
    setUserAnim(direction === 'next' ? 'up' : 'down');
    setTimeout(() => setUserAnim(null), 300);
    setCurrentUser(users[nextIndex]);
  }, [users, currentUser]);

  // =========================================================================
  // Keyboard Navigation
  // =========================================================================
  
  const handleKeyDown = useCallback((event) => {
    // Enter/Space are handled separately for long press detection
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      return;
    }
    
    const currentQueue = queue[category] || [];
    const currentSelected = selected[category] || [];
    
    switch (focusZone) {
      case 'header':
        handleHeaderNavigation(event);
        break;
      case 'queue':
        // Combine queue with session discarded for navigation
        const combinedQueue = [...currentQueue, ...(sessionDiscarded[category] || [])];
        handleQueueNavigation(event, combinedQueue);
        break;
      case 'selected':
        handleSelectedNavigation(event, currentSelected);
        break;
    }
  }, [focusZone, focusIndex, headerFocus, category, queue, selected, sessionDiscarded, users, currentUser]);

  const handleHeaderNavigation = (event) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        setHeaderFocus('category');
        break;
      case 'ArrowRight':
        event.preventDefault();
        setHeaderFocus('user');
        break;
      case 'ArrowDown':
        event.preventDefault();
        // Move to queue
        setFocusZone('queue');
        setFocusIndex(0);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onExit();
        break;
    }
  };

  // Handle Enter/Space action (called on keyup if not long press)
  const handleSelectAction = useCallback(() => {
    const currentQueue = queue[category] || [];
    const currentSelected = selected[category] || [];
    
    switch (focusZone) {
      case 'header':
        // SELECT cycles the current control
        if (headerFocus === 'category') {
          const categories = ['gratitude', 'hopes'];
          const idx = categories.indexOf(category);
          const nextIdx = (idx + 1) % categories.length;
          setCategoryAnim('up');
          setTimeout(() => setCategoryAnim(null), 300);
          setCategory(categories[nextIdx]);
        } else {
          if (users.length && currentUser) {
            const idx = users.findIndex(u => u.id === currentUser.id);
            const nextIdx = (idx + 1) % users.length;
            setUserAnim('up');
            setTimeout(() => setUserAnim(null), 300);
            setCurrentUser(users[nextIdx]);
          }
        }
        break;
      case 'queue':
        // Select the top item (could be from queue or sessionDiscarded)
        const allQueueItems = [...currentQueue, ...(sessionDiscarded[category] || [])];
        if (allQueueItems[0]) {
          handleSelect(allQueueItems[0]);
        }
        break;
      case 'selected':
        // Move item back to queue
        if (currentSelected[focusIndex]) {
          handleRemove(currentSelected[focusIndex]);
        }
        break;
    }
  }, [focusZone, focusIndex, headerFocus, category, queue, selected, sessionDiscarded, users, currentUser, handleSelect, handleRemove]);

  const handleQueueNavigation = (event, items) => {
    // Queue: only top item (index 0) is ever focused
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        // Go to header
        setFocusZone('header');
        setHeaderFocus('category');
        break;
      case 'ArrowDown':
        event.preventDefault();
        // Cycle user (without going to header)
        if (users.length && currentUser) {
          const idx = users.findIndex(u => u.id === currentUser.id);
          const nextIdx = (idx + 1) % users.length;
          // Trigger animation
          setUserAnim('up');
          setTimeout(() => setUserAnim(null), 300);
          setCurrentUser(users[nextIdx]);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        // Dismiss the top item
        if (items[0]) {
          handleDismiss(items[0]);
        }
        break;
      case 'ArrowRight':
        event.preventDefault();
        // Focus the Selected column
        setFocusZone('selected');
        setFocusIndex(0);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onExit();
        break;
    }
  };

  const handleSelectedNavigation = (event, items) => {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        if (focusIndex > 0) {
          setFocusIndex(prev => prev - 1);
        } else {
          // At top, go to header
          setFocusZone('header');
          setHeaderFocus('category');
        }
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (focusIndex < items.length - 1) {
          setFocusIndex(prev => prev + 1);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        // Go back to queue
        setFocusZone('queue');
        break;
      case 'ArrowRight':
        event.preventDefault();
        // No action - already rightmost
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onExit();
        break;
    }
  };

  // Also handle moving from queue to selected via RIGHT when at queue
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

  // Long press detection for category cycling
  useEffect(() => {
    const LONG_PRESS_DURATION = 500; // ms
    
    const handleLongPressStart = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        
        // Ignore repeat events (key held down)
        if (event.repeat) {
          return;
        }
        
        // Reset triggered flag on fresh keydown
        longPressTriggeredRef.current = false;
        
        // Don't start timer if already running
        if (longPressTimerRef.current) return;
        
        longPressTimerRef.current = setTimeout(() => {
          // Long press detected - cycle category (only once)
          longPressTriggeredRef.current = true;
          longPressTimerRef.current = null;
          handleCategoryCycle('next');
        }, LONG_PRESS_DURATION);
      }
    };
    
    const handleLongPressEnd = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        
        // Clear the timer if still running (short press)
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        
        // If long press was NOT triggered, execute the normal action
        if (!longPressTriggeredRef.current) {
          handleSelectAction();
        }
        
        // Reset for next press
        longPressTriggeredRef.current = false;
      }
    };
    
    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleLongPressStart);
      container.addEventListener('keyup', handleLongPressEnd);
      return () => {
        container.removeEventListener('keydown', handleLongPressStart);
        container.removeEventListener('keyup', handleLongPressEnd);
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
        }
      };
    }
  }, [handleCategoryCycle, handleSelectAction]);

  // Note: Removed auto-focus switching - panels stay focusable even when empty

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="gratitude-app-inner" ref={containerRef} tabIndex={0}>
      <div className="gratitude-layout">
        {/* Left side: Header + Queue stacked */}
        <div className="gratitude-left">
          <GratitudeHeader
            category={category}
            currentUser={currentUser}
            users={users}
            focused={focusZone === 'header'}
            headerFocus={headerFocus}
            onCategoryChange={setCategory}
            onUserChange={setCurrentUser}
            onHeaderFocusChange={setHeaderFocus}
            categoryAnim={categoryAnim}
            userAnim={userAnim}
            onCategoryCycle={handleCategoryCycle}
            onUserCycle={handleUserCycle}
          />
          <QueueColumn
            items={queue[category] || []}
            category={category}
            focused={focusZone === 'queue'}
            animatingItem={animatingItem}
            animationDirection={animationDirection}
            newlyAddedItem={newlyAddedItem}
            currentUser={currentUser}
            sessionDiscarded={sessionDiscarded[category] || []}
          />
        </div>
        
        {/* Right side: Selected full height */}
        <div className="gratitude-right">
          <SelectedColumn
            items={selected[category] || []}
            category={category}
            onCategoryChange={setCategory}
            gratitudeCount={(selected.gratitude || []).length}
            hopesCount={(selected.hopes || []).length}
            focused={focusZone === 'selected'}
            focusIndex={focusIndex}
            newlyAddedItem={newlyAddedItem}
            webhookHighlightIds={webhookHighlightIds}
            animatingItem={animatingItem}
            animationDirection={animationDirection}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Gratitude Container (Bootstrap + WebSocket Provider)
// ============================================================================

export default function Gratitude({ clear }) {
  const [users, setUsers] = useState([]);
  const [queue, setQueue] = useState({ gratitude: [], hopes: [] });
  const [selected, setSelected] = useState({ gratitude: [], hopes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadBootstrapData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await DaylightAPI('/api/gratitude/bootstrap');
      
      setUsers(data.users || []);
      setQueue(data.options || { gratitude: [], hopes: [] });
      
      // Transform selections: flatten item structure
      const transformSelections = (selections) => {
        const result = { gratitude: [], hopes: [] };
        for (const cat of ['gratitude', 'hopes']) {
          result[cat] = (selections?.[cat] || []).map(s => ({
            id: s.id,
            text: s.item?.text || s.text,
            itemId: s.item?.id || s.itemId,
            userId: s.userId,
            userName: s.userName,
            datetime: s.datetime,
          }));
        }
        return result;
      };
      
      setSelected(transformSelections(data.selections));
      setError(null);
    } catch (e) {
      logger.error('gratitude.bootstrap.failed', { error: e.message });
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBootstrapData();
  }, [loadBootstrapData]);

  if (loading) {
    return (
      <MantineProvider>
        <div className="app gratitude-app">
          <div className="loading">Loading…</div>
        </div>
      </MantineProvider>
    );
  }

  if (error) {
    return (
      <MantineProvider>
        <div className="app gratitude-app">
          <div className="error">Failed to load. Please retry.</div>
        </div>
      </MantineProvider>
    );
  }

  return (
    <MantineProvider>
      <div className="app gratitude-app">
        <WebSocketProvider>
          <GratitudeApp
            users={users}
            initialQueue={queue}
            initialSelected={selected}
            onExit={clear}
          />
        </WebSocketProvider>
      </div>
    </MantineProvider>
  );
}
