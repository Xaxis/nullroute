/**
 * The device application entry point.
 *
 * Runs in kiosk Chromium against localhost. The only channel it has to anything
 * is a same-origin request to a loopback proxy that forwards to the daemon's
 * Unix socket; the CSP restricts connect-src to 'self', and the page cannot
 * reach the socket directly.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('nullroute: no #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
