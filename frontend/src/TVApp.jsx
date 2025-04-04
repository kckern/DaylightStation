import React, { useState, useEffect, createContext, useContext } from "react";
import TVMenu from "./modules/TVMenu";
import "./TVApp.scss";

export default function TVApp() {
const initialMenuList = [
    { title: "D&C", key: "scripture", value: `d&c ${Math.floor(Math.random() * 132) + 1}` },
    { title: "Book of Mormon Lectures", key: "list", value: { plexId: "438023" } },
    { title: "Bible Project", key: "player", value: { plexId: [463232, 463265], shuffle: true } },
    { title: "Bible", key: "list", value: { plexId: "177777" } },
    { title: "Crash Course Kids", key: "list", value: { plexId: "375840" } },
    { title: "Cooking", key: "list", value: { plexId: "416408" } },
    { title: "Classical", key: "player", value: { plexId: "489862", shuffle: true } },
    { title: "Isaiah", key: "player", value: { plexId: "47230", shuffle: true } },
    { title: "Scribd Coach", key: "list", value: { plexId: "481800" } },
    { title: "DK Ideas", key: "player", value: { plexId: "482225", shuffle: true } }
];

  const backFunction = () => {
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
  };

  useEffect(() => {
    const handlePopState = event => {
      event.preventDefault();
      if (backFunction) {
        backFunction();
        // Push a new state to re-hijack the back button
        window.history.pushState(null, "", window.location.href);
        return false; // Prevent the default action
      }
      return false; // Prevent the default action
    };

    const handleBeforeUnload = event => {
      if (backFunction) {
        event.preventDefault();
        event.returnValue = ""; // Required for some browsers to show the confirmation dialog
        backFunction();
        window.history.pushState(null, "", window.location.href);
        return false; // Prevent the default action
      }
      return false; // Prevent the default action
    };

    // Push initial state to prevent back navigation
    window.history.pushState(null, "", window.location.href);

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return (
    <div className="tv-app-container">
      <div className="tv-app">
        <TVMenu menuList={initialMenuList} />
      </div>
    </div>
  );
}
