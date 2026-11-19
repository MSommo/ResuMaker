import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { CapsProvider } from './api/Caps'
import App from './App'
import './styles/base.css'
import './styles/shell.css'
import './styles/home.css'
import './styles/editor.css'
import './styles/ai.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <CapsProvider>
        <App />
      </CapsProvider>
    </BrowserRouter>
  </StrictMode>,
)
