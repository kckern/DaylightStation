import { useState } from 'react'
import Clock from './modules/Time'
import Weather from './modules/Weather'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '30vh',
          }}
        ><Clock/></div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            width: '25vw',
          }}
        >

        <Weather />
        </div>
      </div>
    </>
  )
}

export default App
