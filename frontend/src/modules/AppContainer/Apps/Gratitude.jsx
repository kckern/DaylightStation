import { MantineProvider } from "@mantine/core";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
    desires: [
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

export default function Gratitude({ clear }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [selections, setSelections] = useState({ gratitude: {}, desires: {} });
    const [options] = useState(optionData);

    // UI sub-modes
    const [selectionsUIMode, setSelectionsUIMode] = useState("header"); // header | fullscreen

    // Navigation state (arrow keys only UI)
    // stages: userSelect | modePicker | categoryGrid | header | fullscreen
    const [stage, setStage] = useState("userSelect");

    // indices
    const [userIndex, setUserIndex] = useState(0);
    const [modeIndex, setModeIndex] = useState(0); // 0 gratitude, 1 desires (mode picker focus)
    const [activeCategory, setActiveCategory] = useState(null); // 'gratitude' | 'desires'
    const [gridIndex, setGridIndex] = useState(0);

    // Header focus: 0 counts, 1 finalize button
    const [headerIndex, setHeaderIndex] = useState(0);

    // Fullscreen navigation
    const [fullscreenSection, setFullscreenSection] = useState('toolbar'); // toolbar | gratitude | desires
    const [fullscreenToolbarIndex, setFullscreenToolbarIndex] = useState(0); // 0 Close, 1 Finalize
    const [fullscreenGratIndex, setFullscreenGratIndex] = useState(0);
    const [fullscreenDesIndex, setFullscreenDesIndex] = useState(0);

    // Focus ref
    const containerRef = useRef(null);
    useEffect(()=>{ containerRef.current && containerRef.current.focus(); }, [stage, selectionsUIMode, currentUser]);

    // Adjust stage when currentUser changes
    useEffect(()=>{
        if (!currentUser) {
            setUserIndex(0); // ensure first user active by default on entry/reset
            setStage('userSelect');
            setActiveCategory(null);
            setSelectionsUIMode('header');
        } else {
            setStage('modePicker');
            setModeIndex(0);
        }
    }, [currentUser]);

    const users = userData; // stable ref

    const toggleSelection = useCallback((category, optionId) => {
        if(!currentUser) return;
        const userId = currentUser.id;
        setSelections(prev => {
            const catMap = { ...prev[category] };
            const list = new Set(catMap[userId] || []);
            if (list.has(optionId)) list.delete(optionId); else list.add(optionId);
            catMap[userId] = Array.from(list);
            return { ...prev, [category]: catMap };
        });
    }, [setSelections, currentUser]);

    // Derived for grid navigation
    const currentOptions = activeCategory ? options[activeCategory] : [];
    const GRID_COLUMNS = 4; // heuristic for arrow up/down movement

    const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

    const moveGrid = (dir) => {
        if(!currentOptions.length) return;
        let idx = gridIndex;
        switch(dir){
            case 'left': idx = (idx - 1 + currentOptions.length) % currentOptions.length; break;
            case 'right': idx = (idx + 1) % currentOptions.length; break;
            case 'up': {
                idx = idx - GRID_COLUMNS;
                if (idx < 0) { 
                    idx = 0; 
                    // move focus to header but KEEP grid visible (activeCategory retained)
                    setStage('header');
                    setHeaderIndex(0);
                    return; 
                }
                break; 
            }
            case 'down': idx = idx + GRID_COLUMNS; if (idx >= currentOptions.length) idx = currentOptions.length -1; break;
        }
        setGridIndex(idx);
    };

    const handleKeyDown = (e) => {
        const key = e.key;
        if (key === 'Tab') { e.preventDefault(); }
        if (key.startsWith('Arrow')) { e.preventDefault(); }
        // Stop propagation for ESC (and any handled navigation key if desired later)
        if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
        // Global Esc handling (hierarchical unwind)
        if (key === 'Escape') {
            if (stage === 'fullscreen') {
                // Equivalent to pressing Close in fullscreen
                setSelectionsUIMode('header');
                setStage('header');
                return;
            } else if (stage === 'header') {
                // Equivalent to Finalize & Exit (clear current user)
                setCurrentUser(null);
                return;
            } else if (stage === 'categoryGrid') {
                // Move up one level to mode picker
                setStage('modePicker');
                return;
            } else if (stage === 'modePicker') {
                // Move up to user selection
                setStage('userSelect');
                return;
            } else if (stage === 'userSelect') {
                // At root: exit app entirely
                if (typeof clear === 'function') clear();
                return;
            }
        }

        switch(stage){
            case 'userSelect': {
                if(['ArrowLeft','ArrowUp'].includes(key)) { setUserIndex(i=> (i -1 + users.length) % users.length); }
                if(['ArrowRight','ArrowDown'].includes(key)) { setUserIndex(i=> (i +1) % users.length); }
                if(key==='Enter') { setCurrentUser(users[userIndex]); }
                break;
            }
            case 'modePicker': {
                if(key==='ArrowLeft') { setModeIndex(0); }
                if(key==='ArrowRight') { setModeIndex(1); }
                if(key==='Enter') {
                    const cat = modeIndex===0? 'gratitude':'desires';
                    setActiveCategory(cat);
                    setStage('categoryGrid');
                    setGridIndex(0);
                }
                if(key==='ArrowUp') { // move to header
                    setStage('header');
                    setHeaderIndex(0);
                }
                break;
            }
            case 'categoryGrid': {
                if(key.startsWith('Arrow')) {
                    const dir = key.replace('Arrow','').toLowerCase();
                    moveGrid(dir);
                }
                if(key==='Enter') {
                    const option = currentOptions[gridIndex];
                    option && toggleSelection(activeCategory, option.id);
                }
                break;
            }
            case 'header': {
                if(['ArrowLeft','ArrowRight'].includes(key)) {
                    setHeaderIndex(i=> i===0?1:0);
                }
                if(key==='ArrowDown') { 
                    if(activeCategory) {
                        setStage('categoryGrid');
                    } else {
                        setStage('modePicker');
                    }
                }
                if(key==='Enter') {
                    if(headerIndex===0) { // open fullscreen
                        setSelectionsUIMode('fullscreen');
                        setStage('fullscreen');
                        setFullscreenSection('toolbar');
                        setFullscreenToolbarIndex(0);
                    } else {
                        // finalize & exit (clear current user)
                        setCurrentUser(null);
                    }
                }
                break;
            }
            case 'fullscreen': {
                if(fullscreenSection === 'toolbar') {
                    if(['ArrowLeft','ArrowRight'].includes(key)) {
                        setFullscreenToolbarIndex(i=> i===0?1:0);
                    }
                    if(key==='ArrowDown') {
                        // move to first non-empty category (gratitude then desires)
                        const hasGrat = (selections.gratitude[currentUser.id]||[]).length>0;
                        const hasDes = (selections.desires[currentUser.id]||[]).length>0;
                        if(hasGrat) setFullscreenSection('gratitude'); else if(hasDes) setFullscreenSection('desires');
                    }
                    if(key==='Enter') {
                        if(fullscreenToolbarIndex===0) { // Close
                            setSelectionsUIMode('header');
                            setStage('header');
                        } else { // finalize & exit
                            setCurrentUser(null);
                        }
                    }
                } else {
                    // in a list
                    const list = fullscreenSection==='gratitude' ? (selections.gratitude[currentUser.id]||[]) : (selections.desires[currentUser.id]||[]);
                    if(['ArrowLeft','ArrowRight'].includes(key)) {
                        // switch section or go toolbar
                        if(fullscreenSection==='gratitude' && key==='ArrowRight') {
                            setFullscreenSection('desires');
                        } else if(fullscreenSection==='desires' && key==='ArrowLeft') {
                            setFullscreenSection('gratitude');
                        } else if(key==='ArrowLeft' && fullscreenSection==='gratitude') {
                            setFullscreenSection('toolbar');
                        } else if(key==='ArrowRight' && fullscreenSection==='desires') {
                            setFullscreenSection('toolbar');
                        }
                    }
                    if(['ArrowUp','ArrowDown'].includes(key)) {
                        if(key==='ArrowUp') {
                            if(fullscreenSection==='gratitude' && fullscreenGratIndex===0) { setFullscreenSection('toolbar'); return; }
                            if(fullscreenSection==='desires' && fullscreenDesIndex===0) { setFullscreenSection('toolbar'); return; }
                        }
                        if(list.length){
                            if(fullscreenSection==='gratitude') {
                                setFullscreenGratIndex(i=> clamp(key==='ArrowDown'? i+1 : i-1, 0, list.length-1));
                            } else {
                                setFullscreenDesIndex(i=> clamp(key==='ArrowDown'? i+1 : i-1, 0, list.length-1));
                            }
                        }
                    }
                    if(key==='Enter') {
                        // remove
                        if(list.length){
                            const idx = fullscreenSection==='gratitude'? fullscreenGratIndex : fullscreenDesIndex;
                            const optionId = list[idx];
                            if(optionId!=null) {
                                setSelections(prev => {
                                    const cat = { ...prev[fullscreenSection] };
                                    const filtered = (cat[currentUser.id]||[]).filter(id=> id!== optionId);
                                    cat[currentUser.id] = filtered;
                                    return { ...prev, [fullscreenSection]: cat };
                                });
                                if(fullscreenSection==='gratitude') setFullscreenGratIndex(i=> clamp(i,0, Math.max(0,(list.length-2))));
                                else setFullscreenDesIndex(i=> clamp(i,0, Math.max(0,(list.length-2))));
                            }
                        }
                    }
                }
                break;
            }
            default: break;
        }
    };

    // Ensure focus stays on container (especially for initial userSelect stage / TV remotes)
    useEffect(()=>{
        const ensureFocus = () => {
            if(containerRef.current && document.activeElement !== containerRef.current){
                containerRef.current.focus();
            }
        };
        ensureFocus();
    }, [stage]);

    // Global fallback listener in case container loses focus
    useEffect(()=>{
        const listener = (e)=> {
            if(e.key === 'Escape') {
                // Always route Escape through our handler (even if container is focused)
                handleKeyDown(e); // handleKeyDown will preventDefault & stopPropagation
                return; // ensure we don't double-handle below
            }
            // If container not focused, still process navigation for arrow/enter keys
            if(document.activeElement !== containerRef.current) handleKeyDown(e);
        };
        window.addEventListener('keydown', listener, true); // capture to intercept early
        return ()=> window.removeEventListener('keydown', listener, true);
    }, [handleKeyDown]);

    return (
    <MantineProvider>
        <div
            className="gratitude-container"
            ref={containerRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
        >
            <GratitudeSelections
                users={users}
                clear={()=> setCurrentUser(null)}
                selections={selections}
                setSelections={setSelections}
                currentUser={currentUser}
                options={options}
                selectionsUIMode={selectionsUIMode}
                setSelectionsUIMode={setSelectionsUIMode}
                stage={stage}
                headerIndex={headerIndex}
                fullscreenSection={fullscreenSection}
                fullscreenToolbarIndex={fullscreenToolbarIndex}
                fullscreenGratIndex={fullscreenGratIndex}
                fullscreenDesIndex={fullscreenDesIndex}
            />
            {stage === 'userSelect' && (
                <UserSelector
                    users={users}
                    userIndex={userIndex}
                />
            )}
            {currentUser && (
                <GratitudeSelector
                    currentUser={currentUser}
                    options={options}
                    selections={selections}
                    setSelections={setSelections}
                    stage={stage}
                    modeIndex={modeIndex}
                    activeCategory={activeCategory}
                    gridIndex={gridIndex}
                />
            )}

        </div>
    </MantineProvider>
  );
}

// Header / Fullscreen selections manager
const GratitudeSelections = ({ selections, setSelections, clear, currentUser, options, selectionsUIMode, setSelectionsUIMode, stage, headerIndex, fullscreenSection, fullscreenToolbarIndex, fullscreenGratIndex, fullscreenDesIndex }) => {
    // When no currentUser yet (user select stage), show a passive header with zero counts
    if(!currentUser) {
        return (
            <div className="gratitude-selections-header">
                <div className="counts">
                    <span>Gratitude: 0</span>
                    <span>Desires: 0</span>
                </div>
                <div className="actions">
                    <button disabled>Finalize & Exit</button>
                </div>
            </div>
        );
    }
    const userId = currentUser.id;
    const gratitudeCount = (selections.gratitude[userId] || []).length;
    const desiresCount = (selections.desires[userId] || []).length;

    const optionLookup = useMemo(()=>({
        gratitude: Object.fromEntries(options.gratitude.map(o=>[o.id, o])),
        desires: Object.fromEntries(options.desires.map(o=>[o.id, o]))
    }), [options]);

    const removeSelection = useCallback((category, optionId)=>{
        setSelections(prev => {
            const cat = { ...prev[category] };
            const list = (cat[userId] || []).filter(id => id !== optionId);
            cat[userId] = list;
            return { ...prev, [category]: cat };
        });
    }, [setSelections, userId]);

    if (selectionsUIMode === "fullscreen") {
        const gratList = (selections.gratitude[userId] || []);
        const desList = (selections.desires[userId] || []);
        return (
            <div className="gratitude-selections-fullscreen">
                <div className="toolbar">
                    <button className={fullscreenSection==='toolbar' && fullscreenToolbarIndex===0? 'focused': ''}>Close</button>
                    <button className={fullscreenSection==='toolbar' && fullscreenToolbarIndex===1? 'focused': ''}>Finalize & Exit</button>
                </div>
                <h2>{currentUser.name}'s Selections</h2>
                <div className="category-group">
                    <h3>Gratitude ({gratitudeCount})</h3>
                    <ul className="selected-list">
                        {gratList.map((id, i) => (
                            <li key={id} className={fullscreenSection==='gratitude' && fullscreenGratIndex===i? 'focused': ''}>
                                {optionLookup.gratitude[id]?.text || id}
                                <span className="remove">✕</span>
                            </li>
                        ))}
                        {gratitudeCount === 0 && <li className="empty">None selected</li>}
                    </ul>
                </div>
                <div className="category-group">
                    <h3>Desires ({desiresCount})</h3>
                    <ul className="selected-list">
                        {desList.map((id, i) => (
                            <li key={id} className={fullscreenSection==='desires' && fullscreenDesIndex===i? 'focused': ''}>
                                {optionLookup.desires[id]?.text || id}
                                <span className="remove">✕</span>
                            </li>
                        ))}
                        {desiresCount === 0 && <li className="empty">None selected</li>}
                    </ul>
                </div>
            </div>
        );
    }

    // header mode (only rendered if not fullscreen)
    const isHeaderStage = stage==='header';
    return (
        <div className="gratitude-selections-header">
            <div className={`counts ${isHeaderStage && headerIndex===0? 'focused': ''}`}> 
                <span>Gratitude: {gratitudeCount}</span>
                <span>Desires: {desiresCount}</span>
            </div>
            <div className="actions">
                <button className={isHeaderStage && headerIndex===1? 'focused': ''}>Finalize & Exit</button>
            </div>
        </div>
    );
}

const GratitudeSelector = ({ currentUser, options, selections, setSelections, stage, modeIndex, activeCategory, gridIndex }) => {
    const [internalMode, setInternalMode] = useState(null); // for click fallback

    // sync with keyboard stage changes
    useEffect(()=>{
        if(stage==='modePicker') setInternalMode(null);
        if(stage==='categoryGrid' && activeCategory) setInternalMode(activeCategory);
    }, [stage, activeCategory]);

    const toggleSelection = useCallback((category, optionId) => {
        if(!currentUser) return;
        const userId = currentUser.id;
        setSelections(prev => {
            const catMap = { ...prev[category] };
            const list = new Set(catMap[userId] || []);
            if (list.has(optionId)) list.delete(optionId); else list.add(optionId);
            catMap[userId] = Array.from(list);
            return { ...prev, [category]: catMap };
        });
    }, [setSelections, currentUser]);

    // SHOW MODE PICKER when no activeCategory (modePicker stage) or header stage WITHOUT fullscreen
    if(((stage==='modePicker') || (stage==='header' && !activeCategory)) && !activeCategory) return <div className="gratitude-mode-picker">
        <h2>Select Gratitude or Desires</h2>
        <div className="buttons">
            <button className={stage==='modePicker' && modeIndex===0? 'focused': ''} onClick={()=> setInternalMode('gratitude')}>Gratitude</button>
            <button className={stage==='modePicker' && modeIndex===1? 'focused': ''} onClick={()=> setInternalMode('desires')}>Desires</button>
        </div>
    </div>;

    // Keep grid visible when header is focused (stage==='header') after navigating up from grid
    if((stage==='categoryGrid' || (stage==='header' && activeCategory)) && activeCategory) {
        const opts = options[activeCategory];
        const selectedIds = (selections[activeCategory][currentUser.id]||[]);
        return (
            <div className="gratitude-selector-wrapper">
                <div className="mode-switcher">
                    <button className={`${activeCategory==='gratitude'? 'active': ''} ${modeIndex===0 && stage!=='header'? 'focused': ''}`} onClick={()=> setInternalMode('gratitude')}>Gratitude</button>
                    <button className={`${activeCategory==='desires'? 'active': ''} ${modeIndex===1 && stage!=='header'? 'focused': ''}`} onClick={()=> setInternalMode('desires')}>Desires</button>
                </div>
                <div className={`gratitude-selector-grid ${activeCategory}`}>
                    {opts.map((o, i)=> (
                        <div
                            key={o.id}
                            className={`gratitude-option ${selectedIds.includes(o.id)? 'selected': ''} ${(stage==='categoryGrid' && gridIndex===i)? 'focused': ''}`}
                            onClick={()=> toggleSelection(activeCategory, o.id)}
                        >{o.text}</div>
                    ))}
                </div>
            </div>
        );
    }
    return null;
}

const UserSelector = ({ users, userIndex }) => {
  return (
    <div className="user-selector">
      <h3>Select a User</h3>
      <ul>
        {users.map((user, index) => (
          <li key={index} className={userIndex===index? 'focused': ''}>
            {user.name}
          </li>
        ))}
      </ul>
    </div>
  );
}