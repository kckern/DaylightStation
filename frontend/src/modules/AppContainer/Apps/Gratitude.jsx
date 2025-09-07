import { MantineProvider } from "@mantine/core";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import "./Gratitude.scss";

const userData = [
  { name: "Alice" , id: 1 },
  { name: "Bob" , id: 2 },
  { name: "Charlie" , id: 3 },
];
const optionData = {
    gratitude: [
        { text: "Warm blanket", id: 1 },
        { text: "Food", id: 2 },
        { text: "Family", id: 3 },
        { text: "Friends", id: 4 },
        { text: "Health", id: 5 },
        { text: "Nature", id: 6 },
        { text: "Technology", id: 7 },
        { text: "Music", id: 8 },
        { text: "Art", id: 9 },
    ],
    desires: [
        { text: "Travel", id: 1 },
        { text: "Learning", id: 2 },
        { text: "Adventure", id: 3 },
        { text: "Peace", id: 4 },
        { text: "Joy", id: 5 },
        { text: "Success", id: 6 },
        { text: "Creativity", id: 7 },
        { text: "Community", id: 8 },
    ]
}

function GratitudeBreadcrumbs({ currentUser, onBackToHome }) {
    return (
        <div className="breadcrumbs">
            <span className="breadcrumb-link" onClick={onBackToHome}>Home</span> 
            &gt; 
            <span>{currentUser ? currentUser.name : "Select User"}</span>
        </div>
    );
}

export default function Gratitude({ clear }) {
    const [currentUser, setCurrentUser] = useState(null);

    const handleBackToHome = () => {
        setCurrentUser(null);
    };

    return (
    <MantineProvider withGlobalStyles withNormalizeCSS>
        <div className="app gratitude-app">
            <h1>Gratitude</h1>
            <GratitudeBreadcrumbs currentUser={currentUser} onBackToHome={handleBackToHome} />
            {currentUser ? (
                <div>
                    <h2>Welcome, {currentUser.name}!</h2>
                    <p>This is where the main app content would go.</p>
                    <button onClick={() => setCurrentUser(null)} className="switch-user-button">Switch User</button>
                </div>
            ) : (
                <div className="user-selection">
                    <h2>Select User</h2>
                    {userData.map(user => (
                        <button key={user.id} onClick={() => setCurrentUser(user)} className="user-button">
                            {user.name}
                        </button>
                    ))}
                </div>
            )}
            <button onClick={clear} className="close-button">Close App</button>
        </div>
    </MantineProvider>
  );
}
