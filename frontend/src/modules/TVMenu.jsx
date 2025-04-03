import React, { useState, useEffect, useRef } from "react";
import "./TVMenu.scss";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import Scriptures from "./Scriptures";
import Player from "./Player";

const TVMenu = ({ menuList, plexId = null, clear }) => {

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
      
      
      const fetchMenuList = async () => {


        setButtons(menuList);
        setLoaded(true);
      };

      const fetchPlexMenu = async () => {
        const { list, title, img } = await DaylightAPI(
          `media/plex/list/${plexId}`
        );
        setButtons(
          list.map(item => ({
            title: item.title,
            key: "player",
            value: item.key,
            img: item.img
          }))
        );
        setMenuMeta({ title, img, type: "plex" });
        setLoaded(true);
      };

      const getData = async () => {
        if (menuList) {
          await fetchMenuList();
        } else if (plexId) {
          await fetchPlexMenu();
        }
      };

      getData();
    },
    [menuList, plexId]
  );

  useEffect(
    () => {
      if (loaded) {
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
    const clear = () => setCurrentContent(null);
    const { key, value } = selection;
    switch (key) {
      case "scripture":
        setCurrentContent(<Scriptures media={value} clear={clear} />);
        break;
      case "player":
        setCurrentContent(
          <Player
            queue={[{ key: "plex", value }]}
            advance={() => setCurrentContent(null)}
            clear={() => setCurrentContent(null)}
          />
        );
        break;
      case "list":
        setCurrentContent(
          <TVMenu plexId={value.plexId} clear={() => setCurrentContent(null)}  />
        );
        break;
      default:
        setCurrentContent(null);
        break;
    }
  };

  if (currentContent) return currentContent;
  if (!loaded) return null;

  return (
    <div className="tv-menu-container" style={{ transform: `translateY(${-translateY}px)` }} ref={containerRef}>
      <h2>
        {menuMeta.title}
      </h2>
      <div className="tv-menu" ref={menuRef}>
        {buttons.map((button, index) =>{
            const plexId = Array.isArray(button.value?.plexId) ? button.value.plexId[0] : button.value?.plexId || null;
          const img = button.img || (plexId && DaylightMediaPath(`/media/plex/img/${plexId}`)) || null;
          return <div
            key={`${index}-${button.title}`}
            className={`menu-button ${selectedIndex === index
              ? "highlighted"
              : ""}`}
          >
            {img &&
              <img
                src={img}
                alt={button.title}
                className="menu-button-img"
              />}
            <h3 className="menu-button-title">
              {button.title}
            </h3>
          </div>}
        )}
      </div>
    </div>
  );
};

export default TVMenu;
