import { useState, useEffect } from "react";
import "./Player.scss";
import Scriptures from "./Scriptures";


export default function Player({queue, setQueue}) {

    const [{key,value}] = queue;

    if(key==="scripture") return <Scriptures queue={queue} setQueue={setQueue} />


    return <div className="player" >
        PLAYER
        {JSON.stringify(queue)}
    </div>

}