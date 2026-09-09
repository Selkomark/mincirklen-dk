/// <reference types="vite/client" />

// Self-hosted Monaco: no CDN requests. Core + language workers are bundled
// directly into this entry's own chunk output, never loaded from jsdelivr.
//
// Uses `?url` (not `?worker`) — Vite's `?worker` suffix transform doesn't
// resolve reliably inside library-mode builds; `?url` just gives back the
// emitted asset URL, which works the same in app and library builds.
// Import the core editor API directly (not the top-level `monaco-editor`
// package) plus only the language contributions we actually want. The
// top-level package's index auto-registers ~90 basic-language grammars
// (Python, Rust, COBOL-ish DSLs, ...) that bloat the bundle by several MB
// for languages a peer-support platform has no use for.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api.js'

// `language/*/monaco.contribution` wires up rich IntelliSense (worker,
// completions, diagnostics) but does NOT register the language id itself —
// that only happens via `languages/definitions/*/register.js` (the basic
// Monarch tokenizer + `languages.register()` call). Both halves are needed;
// without the definitions import the editor silently falls back to
// 'plaintext'. JSON is the exception — its features module registers itself.
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/html/register.js'

import 'monaco-editor/language/typescript/monaco.contribution.js' // registers 'typescript' + 'javascript'
import 'monaco-editor/language/json/monaco.contribution.js'
import 'monaco-editor/language/css/monaco.contribution.js'
import 'monaco-editor/language/html/monaco.contribution.js'

import editorWorkerUrl from 'monaco-editor/editor/editor.worker.js?url'
import jsonWorkerUrl from 'monaco-editor/language/json/json.worker.js?url'
import cssWorkerUrl from 'monaco-editor/language/css/css.worker.js?url'
import htmlWorkerUrl from 'monaco-editor/language/html/html.worker.js?url'
import tsWorkerUrl from 'monaco-editor/language/typescript/ts.worker.js?url'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const url = (() => {
      switch (label) {
        case 'json':
          return jsonWorkerUrl
        case 'css':
        case 'scss':
        case 'less':
          return cssWorkerUrl
        case 'html':
        case 'handlebars':
        case 'razor':
          return htmlWorkerUrl
        case 'typescript':
        case 'javascript':
          return tsWorkerUrl
        default:
          return editorWorkerUrl
      }
    })()
    return new Worker(url, { type: 'module' })
  },
}

loader.config({ monaco })
