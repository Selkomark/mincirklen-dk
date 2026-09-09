import './sentry'
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

// GitHub Pages (`bun run build:docs`, mode "catalog") hosts only the
// design-system catalog now that the real product runs against a live
// backend — dev-mincirklen.dk locally, GKE/Cloud Run in prod (see
// IaC/) — rather than as a static export. Dynamic imports (not a plain
// `import App from './App'` alongside the catalog one) so each build
// mode only ever pulls in — and ships — the graph it actually needs:
// the catalog build never bundles the real app's routing/auth/session
// pages, not just never renders them.
async function mount() {
  const root = ReactDOM.createRoot(document.getElementById('root')!)

  if (import.meta.env.MODE === 'catalog') {
    const [{ Catalog }, { ThemeProvider }, { ToastRegionRoot }] = await Promise.all([
      import('./Catalog'),
      import('./components/ThemeProvider'),
      import('./components/Toast'),
    ])
    root.render(
      <React.StrictMode>
        <ThemeProvider>
          <Catalog />
          <ToastRegionRoot />
        </ThemeProvider>
      </React.StrictMode>,
    )
    return
  }

  const { default: App } = await import('./App')
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void mount()
