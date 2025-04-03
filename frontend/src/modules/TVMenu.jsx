import React, { useState, useEffect, useRef } from "react";
import "./TVMenu.scss";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import Scriptures from "./Scriptures";
import Player from "./Player";
import { useBackFunction } from "../TVApp";

const TVMenu = ({ menuList, plexId = null, clear }) => {

  const {setBackFunction} = useBackFunction();
  const [buttons, setButtons] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuMeta, setMenuMeta] = useState({
    title: "TV Menu",
    img: "",
    type: "default"
  });
  const [loaded, setLoaded] = useState(false);
  const [currentContent, setCurrentContent] = useState(null);

  const menuRef = useRef(null);
  const COL_COUNT = 5;

  useEffect(
    () => {

      //clear && setBackFunction(clear);
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
      if (menuRef.current && loaded) {
        const selectedButton = menuRef.current.querySelector(".highlighted");
        const parent = document.querySelector(".tv-app-container");
        if (selectedButton && parent) {
          const btnRect = selectedButton.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          const isTopRow = selectedIndex < COL_COUNT;
          const scrollTop = isTopRow
            ? 0
            : btnRect.top -
              parentRect.top +
              parent.scrollTop -
              parentRect.height / 2 +
              btnRect.height / 2;
          parent.scrollTo({ top: scrollTop, behavior: "smooth" });
        }
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
            if (clear) {
              clear();
            } else {
              setCurrentContent(null);
            }
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
          <TVMenu plexId={value.plexId} clear={() => setCurrentContent(null)} />
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
    <div className="tv-menu-container">
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
