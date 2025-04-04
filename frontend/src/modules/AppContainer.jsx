import { useState, useEffect, useRef } from "react";


export default function AppContainer({clear})
{
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                clear();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [clear]);
    return <div>
        <h2>App Container</h2>
    </div>
}