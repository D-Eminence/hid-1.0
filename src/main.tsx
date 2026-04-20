import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { scheduleNonCriticalStartup, warmCriticalConnections } from './lib/performance'
import './index.css'

warmCriticalConnections()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)

scheduleNonCriticalStartup()
