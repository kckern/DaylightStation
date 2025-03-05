import { useState } from 'react'
import Calendar from './modules/Calendar'
import Clock from './modules/Time'
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
            height: '100vh',
          }}
        ><Clock/></div>
      </div>
    </>
  )
}

export default App
