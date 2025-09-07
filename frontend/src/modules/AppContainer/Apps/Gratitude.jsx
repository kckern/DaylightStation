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
            {" > "}
            <span>{currentUser ? currentUser.name : "Select User"}</span>
        </div>
    );
}

function UserSelection({ userData, onUserSelect }) {
    return (
        <div className="user-selection">
            <h2>Select User</h2>
            <div className="user-buttons-container">
                {userData.map(user => (
                    <button key={user.id} onClick={() => onUserSelect(user)} className="user-button">
                        {user.name}
                    </button>
                ))}
            </div>
        </div>
    );
}

function UserContent({ currentUser, onSwitchUser }) {
    return (
        <div className="user-content">
            <h2>Welcome, {currentUser.name}!</h2>
            <p>This is where the main app content would go.</p>
            <button onClick={onSwitchUser} className="switch-user-button">Switch User</button>
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
            <div className="app-header">
                <h1>Gratitude</h1>
                <button onClick={clear} className="close-button">×</button>
            </div>
            <GratitudeBreadcrumbs currentUser={currentUser} onBackToHome={handleBackToHome} />
            <div className="main-content">
                {currentUser ? (
                    <UserContent 
                        currentUser={currentUser} 
                        onSwitchUser={() => setCurrentUser(null)} 
                    />
                ) : (
                    <UserSelection 
                        userData={userData} 
                        onUserSelect={setCurrentUser} 
                    />
                )}
            </div>
        </div>
    </MantineProvider>
  );
}
