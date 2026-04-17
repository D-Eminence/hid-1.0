import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initObservability } from './lib/observability'
import './index.css'

void initObservability()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
