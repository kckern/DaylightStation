import { MantineProvider } from "@mantine/core";
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

export default function Gratitude({ clear }) {

    const [currentUser, setCurrentUser] = useState(null);
    const [selections, setSelections] = useState({
        gratitude: [],
        desires: []
    });
    const [options] = useState(optionData);

    const [selectionsUIMode, setSelectionsUIMode] = useState("header"); // header or fullscreen

  return (
    <MantineProvider>
        <div className="gratitude-container">
            {!currentUser && (
                <UserSelector
                    users={userData}
                    currentUser={currentUser}
                    setCurrentUser={setCurrentUser}
                />
            )}
            {currentUser && (
                <>
                    <GratitudeSelections users={userData} clear={()=>setCurrentUser(null)} selections={selections} setSelections={setSelections}  />
                    <GratitudeSelector currentUser={currentUser} options={options} selections={selections} setSelections={setSelections} />
                </>
            )}

        </div>
    </MantineProvider>
  );
}


const GratitudeSelections = ({ users, selections, setSelections, clear }) => {
    //header or fullscreen
}

const GratitudeSelector = ({ currentUser, options, selections, setSelections }) => {
    const [mode, setMode] = useState("gratitude"); // gratitude or desires or null
    if(!mode) return <div>
        <h2>Select Gratitude or Desires</h2>
        <button onClick={() => setMode("gratitude")}>Gratitude</button>
        <button onClick={() => setMode("desires")}>Desires</button>
    </div>;
    return <GratitudeSelectorGrid mode={mode} options={options[mode]} selections={selections[mode]} />;
}

const GratitudeSelectorGrid = ({ mode, options, selections, setSelections }) => {
    return (
        <div className={`gratitude-selector-grid ${mode}`}>
            {options.map((option) => (
                <div
                    key={option.id}
                    className={`gratitude-option ${selections.includes(option.id) ? "selected" : ""}`}
                    onClick={() => {
                        if (selections.includes(option.id)) {
                            setSelections(selections.filter(id => id !== option.id));
                        } else {
                            setSelections([...selections, option.id]);
                        }
                    }}
                >
                    {option.text}
                </div>
            ))}
        </div>
    );
}

const UserSelector = ({ users, currentUser, setCurrentUser }) => {
  return (
    <div className="user-selector">
      <h3>Select a User</h3>
      <ul>
        {users.map((user, index) => (
          <li key={index} onClick={() => setCurrentUser(user)}>
            {user.name}
          </li>
        ))}
      </ul>
    </div>
  );
}