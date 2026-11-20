import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { CapsProvider } from './api/Caps'
import { AuthProvider } from './auth/AuthContext'
import App from './App'
import { ErrorBoundary, installErrorReporting } from './app/errorReporting'
import './styles/base.css'
import './styles/shell.css'
import './styles/home.css'
import './styles/editor.css'
import './styles/ai.css'

installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <CapsProvider>
            <App />
          </CapsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
