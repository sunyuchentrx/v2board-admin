import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles/global.css'
import App from './App'

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root 不存在：检查 admin-v2.blade.php 是否包含 <div id="root">')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
