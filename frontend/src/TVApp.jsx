import React, { useEffect, useState } from "react";
import TVMenu from "./modules/TVMenu";
import "./TVApp.scss";
import { DaylightAPI } from "./lib/api.mjs";




const backFunction = () => {
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
};

function setupNavigationHandlers() {
    const handlePopState = event => {
        event.preventDefault();
        if (backFunction) {
            backFunction();
            window.history.pushState(null, "", window.location.href);
            return false;
        }
        return false;
    };

    const handleBeforeUnload = event => {
        if (backFunction) {
            event.preventDefault();
            event.returnValue = "";
            backFunction();
            window.history.pushState(null, "", window.location.href);
            return false;
        }
        return false;
    };

    // Push initial state to prevent back navigation
    window.history.pushState(null, "", window.location.href);

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
        window.removeEventListener("popstate", handlePopState);
        window.removeEventListener("beforeunload", handleBeforeUnload);
    };
}




export default function TVApp() {
    useEffect(setupNavigationHandlers, []);

    const [list, setList] = useState([]);
    useEffect(() => {
        const fetchData = async () => {
            const data = await DaylightAPI("data/list/TVApp");
            setList(data);
        };
        fetchData();
    }, []);

    const params = new URLSearchParams(window.location.search);
    const queryEntries = Object.fromEntries(params.entries());
    const keysInQuery = Object.keys(queryEntries);

    const autoplay = (() => {
        const mappings = {
            playlist:   (value) => ({ play: { playlist: value } }),
            queue:      (value) => ({ play: { playlist: value } }),
            hymn:       (value) => ({ play: { hymn: value } }),
            media:      (value) => ({ play: { media: value } }),
            talk:       (value) => ({ play: { talk: value } }),
            scripture:  (value) => ({ play: { scripture: value } }),
        };

        for (const [key, value] of Object.entries(queryEntries)) {
            if (mappings[key]) return mappings[key](value);
            return { open: { app: key, param: value } };
        }

        return null;
    })();

    return (
        <div className="tv-app-container">
            <div className="tv-app">
                { list.length === 0 ? <div className="loading">Loading...</div> : <TVMenu list={list} autoplay={autoplay}  /> }
            </div>
        </div>
    );
}
