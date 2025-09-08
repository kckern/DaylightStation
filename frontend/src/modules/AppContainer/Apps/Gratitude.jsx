import { MantineProvider } from "@mantine/core";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { WebSocketProvider, useWebSocket } from "../../../contexts/WebSocketContext.jsx";
import "./Gratitude.scss";

const userData = [
  { name: "Alice" , id: 1 },
  { name: "Bob" , id: 2 },
  { name: "Charlie" , id: 3 },
];
const optionData = {
    gratitude: [
        { text: "Warm blanket", id: 1 },
        { text: "Food", id: 2 },
        { text: "Family", id: 3 },
        { text: "Friends", id: 4 },
        { text: "Health", id: 5 },
        { text: "Nature", id: 6 },
        { text: "Technology", id: 7 },
        { text: "Music", id: 8 },
        { text: "Art", id: 9 },
    ],
    hopes: [
        { text: "Travel", id: 1 },
        { text: "Learning", id: 2 },
        { text: "Adventure", id: 3 },
        { text: "Peace", id: 4 },
        { text: "Joy", id: 5 },
        { text: "Success", id: 6 },
        { text: "Creativity", id: 7 },
        { text: "Community", id: 8 },
    ]
}

function GratitudeBreadcrumbs({ currentUser, currentView, onBackToHome, onBackToUser }) {
    return (
        <div className="breadcrumbs">
            <span className="breadcrumb-link" onClick={onBackToHome}>Home</span> 
            {currentUser && (
                <>
                    {" > "}
                    <span 
                        className={currentView ? "breadcrumb-link" : ""}
                        onClick={currentView ? onBackToUser : undefined}
                    >
                        {currentUser.name}
                    </span>
                </>
            )}
            {currentView && (
                <>
                    {" > "}
                    <span>{currentView === 'gratitude' ? 'Gratitude' : 'Hopes'}</span>
                </>
            )}
        </div>
    );
}

function OptionSelector({ title, options, currentUser, onBack }) {
    const [queue, setQueue] = useState([...options]);
    const [discarded, setDiscarded] = useState([]);
    const [selected, setSelected] = useState([]);
    const [animatingItem, setAnimatingItem] = useState(null);
    const [animationDirection, setAnimationDirection] = useState(null); // 'left' or 'right'
    const [newlyAddedItem, setNewlyAddedItem] = useState(null);
    const [moveHistory, setMoveHistory] = useState([]); // Track moves for undo
    const [highlightedItems, setHighlightedItems] = useState({}); // Track highlighted items with timestamps
    const containerRef = useRef(null);
    
    // WebSocket integration
    const { registerPayloadCallback, unregisterPayloadCallback } = useWebSocket();

    // Handle WebSocket payload to add items to selected
    const handleWebSocketPayload = useCallback((payload) => {
        console.log('WebSocket payload received:', payload);
        
        // Check if payload contains an item that should be added to selected
        if (payload && payload.item && payload.item.id) {
            const item = payload.item;
            console.log('Processing item:', item);
            
            // For custom items (isCustom flag), always add them to selected
            // For predefined items, check if they exist in options and aren't already selected
            const isCustomItem = payload.isCustom || false;
            const existsInOptions = options.some(option => option.id === item.id);
            const alreadySelected = selected.some(selectedItem => selectedItem.id === item.id);
            
            console.log('Item validation:', { isCustomItem, existsInOptions, alreadySelected });
            
            if ((isCustomItem || existsInOptions) && !alreadySelected && !animatingItem) {
                console.log('Adding item to selected with animation');
                
                // Follow the EXACT same pattern as moveToSelected()
                // Step 1: Set up animation state FIRST (before moving item)
                setAnimatingItem(item);
                setAnimationDirection('webhook-right'); // Use a specific direction for webhook
                console.log('Animation state set:', { animatingItem: item, animationDirection: 'webhook-right' });
                
                // Step 2: Start animation, then move after animation completes (just like keystroke)
                setTimeout(() => {
                    // Remove from queue if it's there (only for predefined items)
                    if (!isCustomItem) {
                        setQueue(prev => prev.filter(queueItem => queueItem.id !== item.id));
                    }
                    
                    // Add to selected
                    setSelected(prev => [item, ...prev]);
                    
                    // Clear animation state
                    setAnimatingItem(null);
                    setAnimationDirection(null);
                    
                    // Use newlyAddedItem for slide-in effect (just like keystroke)
                    setNewlyAddedItem({ item: item, column: 'selected' });
                    
                    // Start highlighting the item
                    const highlightKey = `selected-${item.id}`;
                    setHighlightedItems(prev => ({ ...prev, [highlightKey]: Date.now() }));
                    
                    // Remove highlight after 5 seconds
                    setTimeout(() => {
                        setHighlightedItems(prev => {
                            const updated = { ...prev };
                            delete updated[highlightKey];
                            return updated;
                        });
                    }, 5000);
                    
                    // Clear the newly added animation after it completes
                    setTimeout(() => setNewlyAddedItem(null), 300);
                    
                    console.log('Animation sequence completed');
                }, 300); // Match CSS animation duration exactly like keystroke
            } else {
                console.log('Item not added - validation failed, already selected, or animation in progress');
            }
        } else {
            console.log('Invalid payload structure');
        }
    }, [options, selected, animatingItem]);

    // Register/unregister WebSocket callback
    useEffect(() => {
        registerPayloadCallback(handleWebSocketPayload);
        return () => unregisterPayloadCallback();
    }, [registerPayloadCallback, unregisterPayloadCallback, handleWebSocketPayload]);

    // Focus the container on mount to enable keyboard navigation immediately
    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            container.focus();
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            switch (event.key) {
                case 'ArrowLeft':
                case 'ArrowUp':
                    event.preventDefault();
                    moveToDiscard();
                    break;
                case 'ArrowRight':
                case 'Enter':
                    event.preventDefault();
                    moveToSelected();
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    undoLastMove();
                    break;
                case 'Escape':
                    event.preventDefault();
                    event.stopPropagation();
                    onBack();
                    break;
            }
        };

        const container = containerRef.current;
        if (container) {
            container.addEventListener('keydown', handleKeyDown);
            return () => container.removeEventListener('keydown', handleKeyDown);
        }
    }, [queue, selected, discarded]);

    const moveToDiscard = () => {
        if (queue.length > 0 && !animatingItem) {
            const [currentItem, ...remainingQueue] = queue;
            setAnimatingItem(currentItem);
            setAnimationDirection('left');
            
            // Track this move for undo
            setMoveHistory(prev => [...prev, { 
                item: currentItem, 
                from: 'queue', 
                to: 'discarded',
                queueBefore: queue 
            }]);
            
            // Start animation, then move after animation completes
            setTimeout(() => {
                setDiscarded(prev => [currentItem, ...prev]);
                setQueue(remainingQueue);
                setAnimatingItem(null);
                setAnimationDirection(null);
                setNewlyAddedItem({ item: currentItem, column: 'discarded' });
                
                // Start highlighting the item
                const highlightKey = `discarded-${currentItem.id}`;
                setHighlightedItems(prev => ({ ...prev, [highlightKey]: Date.now() }));
                
                // Remove highlight after 5 seconds
                setTimeout(() => {
                    setHighlightedItems(prev => {
                        const updated = { ...prev };
                        delete updated[highlightKey];
                        return updated;
                    });
                }, 1500);
                
                // Clear the newly added animation after it completes
                setTimeout(() => setNewlyAddedItem(null), 300);
            }, 300); // Match CSS animation duration
        }
    };

    const moveToSelected = () => {
        if (queue.length > 0 && !animatingItem) {
            const [currentItem, ...remainingQueue] = queue;
            setAnimatingItem(currentItem);
            setAnimationDirection('right');
            
            // Track this move for undo
            setMoveHistory(prev => [...prev, { 
                item: currentItem, 
                from: 'queue', 
                to: 'selected',
                queueBefore: queue 
            }]);
            
            // Start animation, then move after animation completes
            setTimeout(() => {
                setSelected(prev => [currentItem, ...prev]);
                setQueue(remainingQueue);
                setAnimatingItem(null);
                setAnimationDirection(null);
                setNewlyAddedItem({ item: currentItem, column: 'selected' });
                
                // Start highlighting the item
                const highlightKey = `selected-${currentItem.id}`;
                setHighlightedItems(prev => ({ ...prev, [highlightKey]: Date.now() }));
                
                // Remove highlight after 5 seconds
                setTimeout(() => {
                    setHighlightedItems(prev => {
                        const updated = { ...prev };
                        delete updated[highlightKey];
                        return updated;
                    });
                }, 5000);
                
                // Clear the newly added animation after it completes
                setTimeout(() => setNewlyAddedItem(null), 300);
            }, 300); // Match CSS animation duration
        }
    };

    const undoLastMove = () => {
        if (moveHistory.length > 0 && !animatingItem) {
            const lastMove = moveHistory[moveHistory.length - 1];
            
            // Set up undo animation
            setAnimatingItem(lastMove.item);
            setAnimationDirection(lastMove.to === 'discarded' ? 'undo-from-left' : 'undo-from-right');
            
            // Start animation, then move after animation completes
            setTimeout(() => {
                // Remove the item from its current location
                if (lastMove.to === 'discarded') {
                    setDiscarded(prev => prev.slice(1)); // Remove first item
                    // Clear any highlight for this item
                    const highlightKey = `discarded-${lastMove.item.id}`;
                    setHighlightedItems(prev => {
                        const updated = { ...prev };
                        delete updated[highlightKey];
                        return updated;
                    });
                } else if (lastMove.to === 'selected') {
                    setSelected(prev => prev.slice(1)); // Remove first item
                    // Clear any highlight for this item
                    const highlightKey = `selected-${lastMove.item.id}`;
                    setHighlightedItems(prev => {
                        const updated = { ...prev };
                        delete updated[highlightKey];
                        return updated;
                    });
                }
                
                // Restore the queue state
                setQueue(lastMove.queueBefore);
                
                // Remove this move from history
                setMoveHistory(prev => prev.slice(0, -1));
                
                // Clear animation state
                setAnimatingItem(null);
                setAnimationDirection(null);
                setNewlyAddedItem({ item: lastMove.item, column: 'queue' });
                
                // Clear the newly added animation after it completes
                setTimeout(() => setNewlyAddedItem(null), 300);
            }, 300); // Match CSS animation duration
        }
    };

    const handleSubmit = () => {
        console.log(`${title} selections for ${currentUser.name}:`, {
            selected: selected.map(item => item.id),
            discarded: discarded.map(item => item.id)
        });
        // Here you would typically save the data or call an API
        onBack();
    };

    const renderColumn = (items, title, className, isQueue = false) => (
        <div className={`selector-column ${className}`}>
            <h3>{title}</h3>
            <div className="column-content">
                {items.map((item, index) => {
                    let itemClass = 'selector-item';
                    
                    // Add focused class for queue items
                    if (isQueue && index === 0) {
                        itemClass += ' focused';
                    }
                    
                    // Add highlight class for recently added items in stacks
                    if (index === 0) {
                        const discardHighlightKey = `discarded-${item.id}`;
                        const selectHighlightKey = `selected-${item.id}`;
                        
                        if (className === 'discarded-column' && highlightedItems[discardHighlightKey]) {
                            itemClass += ' recently-added';
                        } else if (className === 'selected-column' && highlightedItems[selectHighlightKey]) {
                            itemClass += ' recently-added';
                        }
                    }
                    
                    // Add sliding animation for queue items
                    if (animatingItem && animatingItem.id === item.id && isQueue && index === 0) {
                        if (animationDirection === 'left' || animationDirection === 'right') {
                            itemClass += ` sliding-${animationDirection}`;
                        } else if (animationDirection === 'webhook-right') {
                            // Webhook items slide from right side of screen
                            itemClass += ' sliding-right';
                        }
                    }
                    
                    // Add undo animation for items in destination stacks
                    if (animatingItem && animatingItem.id === item.id && index === 0) {
                        if (className === 'discarded-column' && animationDirection === 'undo-from-left') {
                            itemClass += ' undo-slide-right';
                        } else if (className === 'selected-column' && animationDirection === 'undo-from-right') {
                            itemClass += ' undo-slide-left';
                        }
                    }
                    
                    // Add slide-in animation for newly added items in stacks
                    if (newlyAddedItem && newlyAddedItem.item.id === item.id && index === 0) {
                        if (className === 'discarded-column' && newlyAddedItem.column === 'discarded') {
                            itemClass += ' slide-in-from-right';
                        } else if (className === 'selected-column' && newlyAddedItem.column === 'selected') {
                            // For webhook items, slide in from RIGHT instead of left
                            itemClass += ' slide-in-from-right';
                        } else if (className === 'queue-column' && newlyAddedItem.column === 'queue') {
                            itemClass += ' slide-in-to-queue';
                        }
                    }
                    
                    return (
                        <div key={item.id} className={itemClass}>
                            {item.text}
                        </div>
                    );
                })}
                {items.length === 0 && (
                    <div className="empty-column">
                        {isQueue ? 'All done!' : '—'}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="option-selector" ref={containerRef} tabIndex={0}>
           
            <div className="selector-columns">
                {renderColumn(discarded, `${discarded.length} Discarded`, 'discarded-column')}
                {renderColumn(queue, title, 'queue-column', true)}
                {renderColumn(selected, `${selected.length} Selected`, 'selected-column')}
            </div>
        </div>
    );
}

function GratitudeSelector({ currentUser, onBack }) {
    return (
        <WebSocketProvider>
            <OptionSelector 
                title="Gratitude"
                options={optionData.gratitude}
                currentUser={currentUser}
                onBack={onBack}
            />
        </WebSocketProvider>
    );
}

function HopesSelector({ currentUser, onBack }) {
    return (
        <WebSocketProvider>
            <OptionSelector 
                title="Hopes"
                options={optionData.hopes}
                currentUser={currentUser}
                onBack={onBack}
            />
        </WebSocketProvider>
    );
}

function UserSelection({ userData, onUserSelect }) {
    const [focusedIndex, setFocusedIndex] = useState(0);
    const containerRef = useRef(null);

    // Focus the container on mount to enable keyboard navigation immediately
    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            container.focus();
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            switch (event.key) {
                case 'ArrowUp':
                case 'ArrowLeft':
                    event.preventDefault();
                    setFocusedIndex(prev => prev > 0 ? prev - 1 : userData.length - 1);
                    break;
                case 'ArrowDown':
                case 'ArrowRight':
                    event.preventDefault();
                    setFocusedIndex(prev => prev < userData.length - 1 ? prev + 1 : 0);
                    break;
                case 'Enter':
                    event.preventDefault();
                    onUserSelect(userData[focusedIndex]);
                    break;
            }
        };

        const container = containerRef.current;
        if (container) {
            container.focus();
            container.addEventListener('keydown', handleKeyDown);
            return () => container.removeEventListener('keydown', handleKeyDown);
        }
    }, [focusedIndex, userData, onUserSelect]);

    return (
        <div className="user-selection" ref={containerRef} tabIndex={0}>
            <div className="user-buttons-container">
                {userData.map((user, index) => (
                    <button 
                        key={user.id} 
                        onClick={() => onUserSelect(user)} 
                        className={`user-button ${index === focusedIndex ? 'focused' : ''}`}
                    >
                        {user.name}
                    </button>
                ))}
            </div>
        </div>
    );
}

function UserContent({ currentUser, onSwitchUser, onSelectOption }) {
    const [focusedIndex, setFocusedIndex] = useState(0);
    const containerRef = useRef(null);
    const options = ['gratitude', 'hopes'];

    // Focus the container on mount to enable keyboard navigation immediately
    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            container.focus();
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            switch (event.key) {
                case 'ArrowUp':
                case 'ArrowLeft':
                    event.preventDefault();
                    setFocusedIndex(prev => prev > 0 ? prev - 1 : options.length - 1);
                    break;
                case 'ArrowDown':
                case 'ArrowRight':
                    event.preventDefault();
                    setFocusedIndex(prev => prev < options.length - 1 ? prev + 1 : 0);
                    break;
                case 'Enter':
                    event.preventDefault();
                    onSelectOption(options[focusedIndex]);
                    break;
                case 'Escape':
                    event.preventDefault();
                    event.stopPropagation();
                    onSwitchUser();
                    break;
            }
        };

        const container = containerRef.current;
        if (container) {
            container.addEventListener('keydown', handleKeyDown);
            return () => container.removeEventListener('keydown', handleKeyDown);
        }
    }, [focusedIndex, options, onSelectOption, onSwitchUser]);

    return (
        <div className="user-content" ref={containerRef} tabIndex={0}>
            <div className="option-buttons-container">
                <button 
                    onClick={() => onSelectOption('gratitude')} 
                    className={`option-button gratitude-button ${focusedIndex === 0 ? 'focused' : ''}`}
                >
                    Gratitude
                </button>
                <button 
                    onClick={() => onSelectOption('hopes')} 
                    className={`option-button hopes-button ${focusedIndex === 1 ? 'focused' : ''}`}
                >
                    Hopes
                </button>
            </div>
        </div>
    );
}

export default function Gratitude({ clear }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [currentView, setCurrentView] = useState(null); // 'gratitude' or 'hopes'

    const handleBackToHome = () => {
        setCurrentUser(null);
        setCurrentView(null);
    };

    const handleBackToUser = () => {
        setCurrentView(null);
    };

    const handleSelectOption = (option) => {
        setCurrentView(option);
    };

    const getTitle = () => {
        if (!currentUser) {
            return "Select Person";
        }
        
        if (!currentView) {
            return currentUser.name;
        }
        
        if (currentView === 'gratitude') {
            return `${currentUser.name}’s Gratitude`;
        }
        
        if (currentView === 'hopes') {
            return `${currentUser.name}’s Hopes`;
        }
        
        return currentUser.name;
    };

    const renderCurrentView = () => {
        if (!currentUser) {
            return (
                <UserSelection 
                    userData={userData} 
                    onUserSelect={setCurrentUser} 
                />
            );
        }

        if (currentView === 'gratitude') {
            return (
                <GratitudeSelector 
                    currentUser={currentUser}
                    onBack={handleBackToUser}
                />
            );
        }

        if (currentView === 'hopes') {
            return (
                <HopesSelector 
                    currentUser={currentUser}
                    onBack={handleBackToUser}
                />
            );
        }

        return (
            <UserContent 
                currentUser={currentUser} 
                onSwitchUser={() => setCurrentUser(null)}
                onSelectOption={handleSelectOption}
            />
        );
    };

    return (
    <MantineProvider withGlobalStyles withNormalizeCSS>
        <div className="app gratitude-app">
            <div className="app-header">
                <h1>{getTitle()}</h1>
                <button onClick={clear} className="close-button">×</button>
            </div>
            <div className="main-content">
                {renderCurrentView()}
            </div>
        </div>
    </MantineProvider>
  );
}
