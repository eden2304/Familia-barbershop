import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"
import RateLimitPopup from "@/components/RateLimitPopup"

function App() {
  return (
    <>
      <Pages />
      <Toaster />
      <RateLimitPopup />
    </>
  )
}

export default App 