import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { LiveRegionProvider } from '@/components/LiveRegionProvider'

ReactDOM.createRoot(document.getElementById('root')).render(
  <LiveRegionProvider>
    <App />
  </LiveRegionProvider>
) 