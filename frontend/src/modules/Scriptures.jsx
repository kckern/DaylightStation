import { useState, useEffect } from "react";
import "./Scriptures.scss";


export default function Scritpures({queue, setQueue}) {

    return <div className="scriptures" >
        SCRIPTURES
        {JSON.stringify(queue)}
    </div>

}