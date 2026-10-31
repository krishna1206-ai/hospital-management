import '@fontsource-variable/public-sans'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { queryFn } from './lib/api.js'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn,
      staleTime: 5000,
      refetchOnWindowFocus: true,
      retry: (count, error) => count < 2 && (error.status === 0 || error.status >= 500),
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
