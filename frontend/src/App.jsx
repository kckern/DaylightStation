import { useState } from 'react'
import Clock from './modules/Time'
import Weather from './modules/Weather'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <div className='sidebar'>
    <Clock/>
    <Weather />
      </div>
    </>
  )
}

export default App
