import type { Monaco } from '@monaco-editor/react'

// Monaco's theme API needs literal color values, not CSS custom properties —
// these are the same hex values as src/tokens/colors.css, kept in sync by hand.
let registered = false

export function registerDsThemes(monaco: Monaco) {
  if (registered) return
  registered = true

  monaco.editor.defineTheme('ds-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1e2625',
      'editorLineNumber.foreground': '#5b6664',
      'editorLineNumber.activeForeground': '#1e2625',
      'editor.lineHighlightBackground': '#eaedec',
      'editorCursor.foreground': '#468679',
      'editor.selectionBackground': '#e3eeec',
      'editorIndentGuide.background': '#dce1df',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#dce1df',
    },
  })

  monaco.editor.defineTheme('ds-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1f2726',
      'editor.foreground': '#e4e9e7',
      'editorLineNumber.foreground': '#9aa6a3',
      'editorLineNumber.activeForeground': '#e4e9e7',
      'editor.lineHighlightBackground': '#121615',
      'editorCursor.foreground': '#7fbfb2',
      'editor.selectionBackground': '#223330',
      'editorIndentGuide.background': '#2b3433',
      'editorWidget.background': '#1f2726',
      'editorWidget.border': '#2b3433',
    },
  })
}
