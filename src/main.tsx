import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/app.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root não encontrado')

// Sem StrictMode: o double-mount do dev derruba os elementos <video> dos decks
// no meio do carregamento e o preview fica piscando.
createRoot(container).render(<App />)
