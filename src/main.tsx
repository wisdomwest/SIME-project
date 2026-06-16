import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SocialDataProvider } from './hooks/useSocialData.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SocialDataProvider>
      <App />
    </SocialDataProvider>
  </StrictMode>,
)
