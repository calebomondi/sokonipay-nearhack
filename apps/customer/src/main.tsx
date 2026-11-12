import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AuthProvider } from '@shared/auth'
import { API } from '@shared/api'
import { loadRate } from '@shared/ui'
import App from './App'
import './index.css'

// Amounts are drawn in shillings, so the rate is read first.
void loadRate(API).finally(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
))
