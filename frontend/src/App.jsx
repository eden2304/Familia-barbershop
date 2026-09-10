import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"
import RateLimitPopup from "@/components/RateLimitPopup"
import SessionExpiredNotice from "@/components/SessionExpiredNotice"
import { SystemPopupProvider } from "@/components/SystemPopupProvider"

function App() {
  return (
    <SystemPopupProvider>
      <Pages />
      <Toaster />
      <RateLimitPopup />
      <SessionExpiredNotice />
    </SystemPopupProvider>
  )
}

export default App 