import { useState, useEffect } from "react";
import "./Player.scss";
import Scriptures from "./Scriptures";


export default function Player({queue, setQueue}) {

    const [{key,value}] = queue;
    const advance = () => setQueue(queue.slice(1));

    if(key==="scripture") return <Scriptures media={value} advance={advance} />

    return <div className="player" >
        PLAYER
        {JSON.stringify(queue)}
    </div>

}