import logo from './logo.svg';
import './App.css';
import Clock from 'react-live-clock';
import rd3 from 'react-d3-library';


import { render } from 'react-dom'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

const RD3Component = rd3.Component;

function App() {
  return (
    <div style={{backgroundColor:"#000", display: 'flex', justifyContent: 'center', height: '100vh', alignItems: 'center'}}>

        <div style={{height:"1080px",width:"1920px", backgroundColor:"#333", display: 'flex'}} className="relative">
          <LeftSideBar/>
          <MainContent/>
          <RightSideBar/>
        </div>
    </div>
  );
}


const options = {
  title: {
    text: 'My chart'
  },
  series: [{
    data: [1, 2, 3]
  }]
}


function LeftSideBar(){
  return(
    <div className="h-full w-1/4 bg-white" style={{padding: '3rem'}}>
      <Clock format={'HH:mm:ss'} ticking={true} timezone={'US/Pacific'} />
    </div>
  )
}

function RightSideBar(){

  return(
    <div className="h-full w-1/4 " style={{padding: '3rem'}}>
      RIGHT
      <HighchartsReact
    highcharts={Highcharts}
    options={options}
  />



    </div>
  )
}

function MainContent(){
  return(
    <div className="h-full w-1/2 " style={{padding: '3rem'}}>
      MAIN
    </div>
  )
}



export default App;
