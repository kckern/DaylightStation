import React, { useEffect, useState } from "react";
import TVMenu from "./modules/TVMenu";
import "./TVApp.scss";
import { DaylightAPI } from "./lib/api.mjs";
import { use } from "react";

/*
valid keys: list, play, open


// PLAY SINGLE with <Player>
{ play: { scripture: "d&c1" mode: "theater" }}
{ play: { hymn: "1000" }}


// PLAY QUEUE with <Player>
{ play: { queue: 
        [ 
            { media: "audio/intro" },
            { scripture: "d&c 1" }, 
            { scripture: "john 2", mode: "minimal", version: ["NRSV"], rate: 2}
            { plex: [123, 456], shuffle: true }
            { plex: 789 },
            { media: "video/cnn" },
        ], 
    repeat: true, 
    mode: "theater" }
}

// SHOW LIST (loadable) with <TVMenu>
{ list: {  plex : 10000, mode: "grid", sort: "played" }
{ list: {  plex : [ 100, 200 ], mode: "grid", sort: "title" }
{ list: { list: "books", mode: "shelf" }}  //todo need new api for this
{ list: { list: "ambient", mode: "shelf" }}

//SHOW LIST (hard coded with  <TVMenu>
{ list: [
    { title: "A", play: { scripture ; "gen 1" }},
    { title: "B", play: { queue ; [...] }},
] }

//Open App with <AppContainer/>
{ open: "glympse", key: "ABC-123"}
{ open: "quiz", id: "999A"}
{ reader: "A"}

*/

const listTMP = [
    { title: "Program", queue: { playlist: "morning"}},
    { title: "Gettysburg", play: { media: "program/usdocs/gettysburg"}},
    { title: "Hymn: OSL",    play: { hymn: "113"}},
    { title: "CNN", play: { media: "program/cnn"}},
    { title: "WS", open: { app: "websocket", param: "ping" }},
    { title: "Tolstoy", queue: { media: "tolstoy"}},
    { title: "Glympse", open: { app: "glympse", param: "BePR-gHkf" }},
    { title: "D&C", 
        play: { scripture: `d&c ${Math.floor(Math.random() * 132) + 1}`, version: "redc" } },
    { title: "D&C 4-5", 
        play: [
            { scripture: `d&c 4`, version: "redc" },
            { scripture: `d&c 5`, version: "redc" },
        ],
    },
    { title: "Genesis 1-5",
        list: [
            { title: "Genesis 1", play: { scripture: "gen 1" } },
            { title: "Genesis 2", play: { scripture: "gen 2" } },
            { title: "Genesis 3", play: { scripture: "gen 3" } },
            { title: "Genesis 4", play: { scripture: "gen 4" } },
            { title: "Genesis 5", play: { scripture: "gen 5" } }
        ] },
    { title: "Book of Mormon Lectures", 
        list: { plex: "438023" } },
    { title: "Bible Project", 
        play: { plex: [463232, 463265], shuffle: true } },
    { title: "Bible", 
        list: { plex: "177777" } },
    { title: "Crash Course Kids", 
        list: { plexId: "375840" } },
    { title: "Cooking", 
        list: { plex: "416408" } },
    { title: "Classical", 
        play: { plex: "489862", shuffle: true } },
    { title: "Isaiah", 
        play: { plex: "47230", shuffle: true } },
    { title: "Scribd Coach", 
        list: { plex: "481800" } },
    { title: "DK Ideas", 
        play: { plex: "482225", shuffle: true } }
]



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
            playlist: (value) => ({ queue: { playlist: value } }),
            queue: (value) => ({ queue: { playlist: value } }),
            hymn: (value) => ({ play: { hymn: value } }),
            media: (value) => ({ play: { media: value } }),
            talk: (value) => ({ play: { talk: value } }),
            scripture: (value) => ({ play: { scripture: value } }),
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
