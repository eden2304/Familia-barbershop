import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { applyA11ySettings, loadA11ySettings } from '@/lib/accessibility'

applyA11ySettings(loadA11ySettings())

document.documentElement.lang = 'he'
document.documentElement.dir = 'rtl'

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
)
