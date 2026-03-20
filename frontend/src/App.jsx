import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"
import RateLimitPopup from "@/components/RateLimitPopup"
import { SystemPopupProvider } from "@/components/SystemPopupProvider"

function App() {
  return (
    <SystemPopupProvider>
      <Pages />
      <Toaster />
      <RateLimitPopup />
    </SystemPopupProvider>
  )
}

export default App 