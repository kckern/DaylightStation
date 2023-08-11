
import './App.css';
import Calendar from './modules/calendar';
import Time from './modules/time';
import Status from './modules/status';
import { useState } from 'react';
import Keypad from './navigation/keypad';



function App() {

  const [mode, setMode] = useState("basic");
  const [queue, setQueue] = useState([]);
  const [foreMedia, setForeMedia] = useState([]);
  const [backMedia, setBackMedia] = useState([]);

  const pushButton = (keyValue) => {
    alert(keyValue);
  };


  return (
    <div style={{
      backgroundColor: "#000",
      display: 'flex',
      justifyContent: 'center',
      height: '100vh',
      width: '100vw',
      alignItems: 'center'
    }}>

      <div style={{
        height:"100%",
        width:"100%",
        backgroundColor: "#333",
        display: 'flex'
      }} >
        { foreMedia.isActive && <FullScreen /> }
        { !foreMedia.isActive &&  <><LeftSideBar /> <MainContent /><RightSideBar /></>}
        <Keypad pushButton={pushButton} />
    </div>
    </div>
  );
}

function FullScreen() {

  const [isOn, setIsOn] = useState(false);

  if(!isOn) return null;

  return <div style={{
    backgroundColor: "#000",
    display: 'flex',
    position: 'absolute',
    justifyContent: 'center',
    height: '100vh',
    width: '100vw',
    alignItems: 'center'
  }}>
    Test
    </div>

}


function LeftSideBar(){
  return(
    <div className="h-full w-1/4 bg-white" style={{padding: '4rem', maxWidth:"100em"}}>
      <Time/>
    </div>
  )
}

function RightSideBar(){

  return(
    <div className="h-full w-1/4  bg-white" style={{padding: '3rem', maxWidth:"100em"}}>
      <Status/>



    </div>
  )
}

function MainContent(){
  return(
    <div className="h-full w-1/2 " style={{padding: '3rem'}}>
      <Calendar/>
    </div>
  )
}



export default App;
