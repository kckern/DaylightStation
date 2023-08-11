
import React, { useState } from 'react';
import './keypad.css';

export default function Keypad({ pushButton }) {
    const [isPeek, setIsPeek] = useState(false);

    const handleMouseOver = () => {
        setIsPeek(true);
    }

    const handleMouseOut = () => {
        setIsPeek(false);
    }

    const handleButtonClick = (keyValue, e) => {
        pushButton(keyValue);
        e.stopPropagation();
    }

    const gridTemplateRows = 'repeat(5, 1fr)';
    const gridTemplateColumns = 'repeat(4, 1fr)';
    const buttonList = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').slice(0, 19);

    return (
        <div className={ `keypad ${isPeek ? 'peek' : ''}`}
            onMouseOver={handleMouseOver}
            onMouseOut={handleMouseOut}
            onClick={()=>setIsPeek(false)}
            style={{
                gridTemplateRows,
                gridTemplateColumns
            }} 
        >
            {buttonList.map((button, index) => (
                <button 
                    key={index}
                    onClick={(e) => handleButtonClick(button,e)}
                    style={{
                        gridRow: index < 1 ? 'span 2' : 'auto'
                    }}
                >
                    {button}
                </button>
            ))}
        </div>
    );
}