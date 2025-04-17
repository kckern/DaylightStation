import React, { useState, useEffect, useRef } from "react";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import Player from "./Player";
import AppContainer from "./AppContainer";
import "./TVMenu.scss";

const TVMenu = ({ list, clear, autoplay }) => {

  const plex = 0;

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

      // Change fetchListData so it accepts the menu/folder name:
      const fetchListData = async (menuOrFolder) => {
        if (!menuOrFolder) {
          setLoaded(true);
          return;
        }
        // Actually fetch using the passed-in string
        const { title, image, kind, items } = await DaylightAPI(`data/list/${menuOrFolder}`);
        console.log({items})
        setButtons(items);
        setMenuMeta({ title, image, kind });
        setLoaded(true);
      };

      // Then in getData, pass that parameter correctly:
      const getData = async () => {
        if (Array.isArray(list.items)) {
          setButtons(list.items);
          const { items, ...rest } = list;
          setMenuMeta(rest);
          setLoaded(true);
        } else if (typeof list === "string") {
          await fetchListData(list);
        } else if (typeof list === "object") {
          setLoaded(false);
          const { menu, list: playlist, plex } = list;
          await fetchListData(menu || playlist || plex);
        } else {
          setButtons([]);
          setMenuMeta({ title: "No Menu", img: "", type: "default" });
          setLoaded(true);
        }
      };

      getData();
    },
    [list, plex]
  );

  useEffect(
    () => {
      if (loaded) {
        if(!containerRef?.current) return;
        if(!menuRef?.current.children[selectedIndex]) return;
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
    const options = {
      "play": <Player {...props} />,
      "queue": <Player {...props} />,
      "playlist": <Player {...props} />,

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
    if(autoplay?.play) {
      const clear = () => setCurrentContent(null);
      setCurrentContent(<Player play={autoplay.play} clear={clear} />);
    }
  }, [autoplay?.queue, autoplay?.open, autoplay?.play]);


  if (currentContent) return currentContent;
  if (!loaded) return null;
  if(!!autoplay && !currentContent) return null;

  return (
    <div className="tv-menu-container" style={{ transform: `translateY(${-translateY}px)` }} ref={containerRef}>
      <h2>
        {menuMeta.title || menuMeta.label}
      </h2>
      <div className="tv-menu" ref={menuRef}>
        {buttons?.map((button, index) => {
          //handle images
          const {plex} = button?.play || button?.queue || button?.list || button?.open || {};
          if(!!plex) button.image = DaylightMediaPath(`/media/plex/img/${Array.isArray(plex) ? plex[0] : plex}`);
          return button;
        })
        .map((button, index) =>{
          const img = button.image || null;
          return <div
            key={`${index}-${button.label}`}
            className={`menu-button ${button.type || ""} ${selectedIndex === index
              ? "highlighted"
              : ""} `}
          >
            <MenuIMG img={img} label={button.label} />
            <h3 className="menu-button-title">
              {button.label}
            </h3>
          </div>}
        )}
      </div>
    </div>
  );
};


function MenuIMG({ img, label }) {
  const [orientation, setOrientation] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    const numericRatio = naturalWidth / naturalHeight;
    const orientation = numericRatio === 1 ? "square" : numericRatio > 1 ? "landscape" : "portrait";
    setOrientation(orientation);
    setLoading(false);
  };

  if (!img) return null;
  

  return (
    <div className={`menu-button-img ${loading ? "loading" : ""} ${orientation}`}>
      <img src={img} alt={label} onLoad={handleImageLoad} style={{ display: loading ? "none" : "block" }}  />
    </div>
  );
}

export default TVMenu;
