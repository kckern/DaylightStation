import React, { useEffect, useState, useRef } from "react";
import TVMenu from "./modules/TVMenu";
import "./TVApp.scss";
import { DaylightAPI } from "./lib/api.mjs";
import { LoadingOverlay } from "./modules/Player";




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

    const [containerAppRatio, setContainerAppRatio] = useState(0);

    useEffect(() => {
        const updateRatio = () => {
            const container = containerRef.current;
            const app = appRef.current;

            if (container && app) {
                const containerWidth = container.offsetWidth;
                const appWidth = app.offsetWidth;
                const ratio = Math.round((appWidth / containerWidth) * 100);
                setContainerAppRatio(ratio);
            }
        };

        updateRatio(); // Initial calculation

        window.addEventListener("resize", updateRatio);
        return () => {
            window.removeEventListener("resize", updateRatio);
        };
    }, [list]);

    const containerRef = useRef(null);
    const appRef = useRef(null);

    return (
        <div className="tv-app-container" ref={containerRef}>
            {!!containerAppRatio && <div className="debug"
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    color: "black",
                    backgroundColor: "rgba(255, 255, 255, 0.8)",
                    padding: "10px",
                    zIndex: 1000,
                }}
            >{containerAppRatio}</div>}
            <div className="tv-app" ref={appRef} >
                { list.length === 0 ? <LoadingOverlay/> : <TVMenu list={list} autoplay={autoplay}  /> }
            </div>
        </div>
    );
}
