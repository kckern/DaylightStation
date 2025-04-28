import React, { useEffect, useState, useRef, useCallback } from "react";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import "./MenuNav.scss";

const MENU_TIMEOUT = 3000;

export default function MenuNav({ list, onSelection, onClose, onMenuState }) {
  const [menuItems, setMenuItems] = useState([]);
  const [menuMeta, setMenuMeta] = useState({ title: "Loading..." });
  const [loaded, setLoaded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(MENU_TIMEOUT);
  const intervalRef = useRef(null);
  const menuRef = useRef(null);

  const fetchListData = async (menuOrFolder) => {
    if (!menuOrFolder) {
      setLoaded(true);
      return { title: "No Menu", image: "", kind: "default", items: [] };
    }
    const { title, image, kind, items } = await DaylightAPI(`data/list/${menuOrFolder}`);
    return { title, image, kind, items };
  };

  useEffect(() => {
    let canceled = false;
    async function getData(input) {
      if (Array.isArray(input?.items)) {
        const { items, ...rest } = input;
        if (!canceled) {
          setMenuItems(items);
          setMenuMeta(rest);
          setLoaded(true);
        }
      } else if (typeof input === "string") {
        const { title, image, kind, items } = await fetchListData(input);
        if (!canceled) {
          setMenuItems(items);
          setMenuMeta({ title, image, kind });
          setLoaded(true);
        }
      } else if (typeof input === "object") {
        const { menu, list: playlist, plex } = input;
        const param = menu || playlist || plex;
        if (param) {
          const { title, image, kind, items } = await fetchListData(param);
          if (!canceled) {
            setMenuItems(items);
            setMenuMeta({ title, image, kind });
            setLoaded(true);
          }
        } else {
          if (!canceled) {
            setMenuItems([]);
            setMenuMeta({ title: "No Menu", image: "", kind: "default" });
            setLoaded(true);
          }
        }
      } else {
        if (!canceled) {
          setMenuItems([]);
          setMenuMeta({ title: "No Menu", image: "", kind: "default" });
          setLoaded(true);
        }
      }
    }
    getData(list);
    if (onMenuState) onMenuState(true);
    return () => {
      canceled = true;
      if (onMenuState) onMenuState(false);
    };
  }, [list, onMenuState]);

  useEffect(() => {
    if (!loaded || !menuItems.length) return;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const newVal = prev - 10;
        if (newVal <= 0) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          console.log(`Handling selection for ${menuItems[selectedIndex].label}`);

          handleSelection(menuItems[selectedIndex]);
          return 0;
        }
        return newVal;
      });
    }, 10);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loaded, menuItems, selectedIndex]);

  const handleSelection = useCallback(
    (choice) => {
      onSelection && onSelection(choice);
    },
    [onSelection]
  );

  useEffect(() => {
    if (!menuItems.length) return;
    const handleKeyDown = (event) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onClose && onClose();
          break;
        case "Enter":
          event.preventDefault();
          handleSelection(menuItems[selectedIndex]);
          break;
        case "ArrowUp":
          setSelectedIndex((prev) => (prev - 1 + menuItems.length) % menuItems.length);
          setTimeLeft(MENU_TIMEOUT);
          break;
        case "ArrowDown":
          setSelectedIndex((prev) => (prev + 1) % menuItems.length);
          setTimeLeft(MENU_TIMEOUT);
          break;
        default:
          setSelectedIndex((prev) => (prev + 1) % menuItems.length);
          setTimeLeft(MENU_TIMEOUT);
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuItems, onClose, handleSelection, selectedIndex]);

  useEffect(() => {
    if (!menuRef.current || !menuItems.length) return;
    const container = menuRef.current;
    const selectedElem = container.querySelector(".menu-item.active");
    if (!selectedElem) return;
    container.scrollTo({
      top: selectedElem.offsetTop - container.clientHeight / 2 + selectedElem.clientHeight / 2,
      behavior: "smooth",
    });
  }, [selectedIndex, menuItems]);

  if (!loaded || !menuItems.length) return null;

  return (
    <div className="menunav">
      <h2>{menuMeta.title || menuMeta.label}</h2>
      <ProgressTimeoutBar timeLeft={timeLeft} />
      <div className="menu-items" ref={menuRef}>
        {menuItems.map((item, i) => {
          const { plex } = item.play || item.queue || item.list || item.open || {};
          if (plex) {
            const plexId = Array.isArray(plex) ? plex[0] : plex;
            item.image = DaylightMediaPath(`/media/plex/img/${plexId}`);
          }
          return (
            <div key={item.uid || i} className={`menu-item ${selectedIndex === i ? "active" : ""}`}>
              <MenuNavIMG img={item.image} label={item.label} />
              <div className="menu-item-label">{item.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MenuNavIMG({ img, label }) {
  const [orientation, setOrientation] = useState(null);
  const [loading, setLoading] = useState(!!img);
  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    const ratio = naturalWidth / naturalHeight;
    const newOrientation = ratio === 1 ? "square" : ratio > 1 ? "landscape" : "portrait";
    setOrientation(newOrientation);
    setLoading(false);
  };
  if (!img) return null;
  return (
    <div className={`menu-nav-img ${loading ? "loading" : ""} ${orientation || ""}`}>
      <img src={img} alt={label} onLoad={handleImageLoad} style={{ display: loading ? "none" : "block" }} />
    </div>
  );
}

function ProgressTimeoutBar({ timeLeft }) {
  return (
    <div className="progress-bar">
      <div className="progress" style={{ width: `${(1 - timeLeft / MENU_TIMEOUT) * 100}%` }} />
      <span className="progress-text" />
    </div>
  );
}