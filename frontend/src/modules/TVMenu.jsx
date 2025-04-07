import React, { useState, useEffect, useRef } from "react";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import Player from "./Player";
import AppContainer from "./AppContainer";
import "./TVMenu.scss";

const TVMenu = ({ list, menu, clear, autoplay }) => {

  const plexId = 0;

  const [buttons, setButtons] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuMeta, setMenuMeta] = useState({
    title: "TV Menu",
    img: "",
    type: "default"
  });
  const [loaded, setLoaded] = useState(false);
  const [currentContent, setCurrentContent] = useState(null);
  const [translateY, setTranslateY] = useState(0);
  const containerRef = useRef(null);


  const menuRef = useRef(null);
  const COL_COUNT = 5;

  const escapeHandler = () => {
   // alert("Escape");
    if (currentContent) {
      setCurrentContent(null);
    }
    if (clear) {
      clear();
    }
  };


  useEffect(
    () => {

      //3 possible: hard coded, media, plex
      
      const fetchMenuList = async () => {

        //if menu is set, 
        const menuList = list?.menu && await DaylightAPI(  `data/nav/${list?.menu}`  ) || null;

      

        setButtons( menuList || list || [] );
        setLoaded(true);
      };

      const fetchPlexMenu = async () => {
        const { list, title, img } = await DaylightAPI(
          `media/plex/list/${plexId}`
        );
        setButtons(
          list.map(item => ({
            label: item.title,
            play: {plex: item.key},
            key: "player",
            value: item.key,
            img: item.img
          }))
        );
        setMenuMeta({ title, img, type: "plex" });
        setLoaded(true);
      };

      const getData = async () => {
        if (list) {
          await fetchMenuList();
        } else if (plexId) {
          await fetchPlexMenu();
        }
      };

      getData();
    },
    [list, plexId]
  );

  useEffect(
    () => {
      if (loaded) {
        if(!containerRef?.current) return;
        const heightOfContainer = containerRef.current.offsetHeight;
        const heightOfSelectedButton = menuRef.current.children[selectedIndex].offsetHeight;
        const buttonDistance = menuRef.current.children[selectedIndex].offsetTop;
        const targetDistanceForVerticalCentering = buttonDistance - (heightOfContainer / 2) + (heightOfSelectedButton / 2);
        const maxDistance = menuRef.current.scrollHeight - heightOfContainer;
        const minDistance = 0;
        const distance = Math.max(minDistance, Math.min(maxDistance, targetDistanceForVerticalCentering));
        setTranslateY(distance);
      }
    },
    [selectedIndex, loaded]
  );

  useEffect(
    () => {
      const handleKeyDown = e => {
        if (currentContent) return;
        switch (e.key) {
          case "Enter":
            handleSelection(buttons[selectedIndex]);
            break;
          case "ArrowUp":
            setSelectedIndex(
              prev => (prev - COL_COUNT + buttons.length) % buttons.length
            );
            break;
          case "ArrowDown":
            setSelectedIndex(prev => (prev + COL_COUNT) % buttons.length);
            break;
          case "ArrowLeft":
            setSelectedIndex(
              prev => (prev - 1 + buttons.length) % buttons.length
            );
            break;
          case "ArrowRight":
            setSelectedIndex(prev => (prev + 1) % buttons.length);
            break;
          case "Escape":
            e.preventDefault();
            escapeHandler();
            break;
          default:
            break;
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    },
    [selectedIndex, buttons, currentContent, clear]
  );

  const handleSelection = selection => {
    if (!selection || !selection.label) {
      alert("Invalid selection. Please try again.");
      return;
    }

    

    const clear = () => setCurrentContent(null);
    const props = { ...selection, clear };
    console.log("props", props);
    const options = {
      "play": <Player {...props} />,
      "queue": <Player {...props} />,
      "list": <TVMenu {...props} />,
      "menu": <TVMenu {...props} />,
      "open": <AppContainer {...props} />,
    };

    const selectionKeys = Object.keys(selection);
    const availableKeys = Object.keys(options);
    const firstMatch = selectionKeys.find(key => availableKeys.includes(key)) || null;

    if (firstMatch) {
      setCurrentContent(options[firstMatch]);
    } else {
      alert(`No valid action found for selection (${JSON.stringify(selectionKeys)}). Available options are: ${availableKeys.join(", ")}`);
    }
  };

  useEffect(() => {
    if (autoplay?.queue?.playlist) {
      const clear = () => setCurrentContent(null);
      setCurrentContent(<Player queue={autoplay.queue} clear={clear} />);
    }
    if(autoplay?.open) {
      const clear = () => setCurrentContent(null);
      setCurrentContent(<AppContainer open={autoplay.open} clear={clear} />);
    }
    if(autoplay?.play?.hymn) {
      const clear = () => setCurrentContent(null);
      setCurrentContent(<Player play={autoplay.play} clear={clear} />);
    }
  }, [autoplay?.queue, autoplay?.open, autoplay?.play]);


  if (currentContent) return currentContent;
  if (!loaded) return null;


  return (
    <div className="tv-menu-container" style={{ transform: `translateY(${-translateY}px)` }} ref={containerRef}>
      <h2>
        {menuMeta.title || menuMeta.label}
      </h2>
      <div className="tv-menu" ref={menuRef}>
        {buttons.map((button, index) =>{
            const plexId = Array.isArray(button.value?.plexId) ? button.value.plexId[0] : button.value?.plexId || null;
          const img = button.image || (plexId && DaylightMediaPath(`/media/plex/img/${plexId}`)) || null;
          return <div
            key={`${index}-${button.label}`}
            className={`menu-button ${selectedIndex === index
              ? "highlighted"
              : ""}`}
          >
            {img &&
              <img
                src={img}
                alt={button.label}
                className="menu-button-img"
              />}
            <h3 className="menu-button-title">
              {button.label}
            </h3>
          </div>}
        )}
      </div>
    </div>
  );
};

export default TVMenu;
