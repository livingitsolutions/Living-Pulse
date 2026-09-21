import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import GrowthConsole from '../src/GrowthConsole'
import '../src/index.css'

createRoot(document.getElementById('root')!).render(<StrictMode><GrowthConsole /></StrictMode>)
