import { Component, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { ErrorPage } from './pages/ErrorPage'
import i18n from './i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

// A class component, not a hook: React only supports catching a render
// crash in children via getDerivedStateFromError/componentDidCatch, which
// have no functional-component equivalent. This is the app's "5xx" —
// something broke unexpectedly, as opposed to a recoverable in-page
// failure (a failed fetch, a bad form submit), which pages already
// surface inline via Alert per the async-action-buttons pattern.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary] unexpected render error', error, info.componentStack)
    Sentry.captureReactException(error, info)

    // Usually already loaded by the time a real crash happens (every
    // namespace, including "errors", is preloaded eagerly — see i18n.ts's
    // `ns: NAMESPACES`) — but each namespace's resource file is still an
    // async dynamic import (i18n.ts's resourcesToBackend), so a crash on
    // the very first render can beat it, rendering the literal
    // "errors:boundary.title" key instead of real text. Waits for the
    // load, then re-renders once it lands.
    if (!i18n.hasLoadedNamespace('errors')) {
      void i18n.loadNamespaces('errors').then(() => this.forceUpdate())
    }
  }

  render() {
    if (this.state.hasError) {
      // A class component, not `useTranslation` — reads the i18next
      // singleton directly, since this must render before React itself
      // has necessarily settled (see componentDidCatch's forceUpdate for
      // the one case where the singleton's data arrives after this first
      // renders).
      return (
        <ErrorPage code={500} title={i18n.t('errors:boundary.title')} message={i18n.t('errors:boundary.message')} />
      )
    }
    return this.props.children
  }
}
