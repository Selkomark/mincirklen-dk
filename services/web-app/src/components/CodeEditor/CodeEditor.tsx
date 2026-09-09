import Editor, { type EditorProps, type OnMount } from '@monaco-editor/react'
import { useTheme } from '../ThemeProvider'
import './monacoSetup'
import { registerDsThemes } from './monacoThemes'
import './CodeEditor.css'

export interface CodeEditorProps extends Omit<EditorProps, 'theme'> {
  className?: string
}

export function CodeEditor({ height = 320, className, onMount, ...props }: CodeEditorProps) {
  const { theme } = useTheme()
  const monacoTheme = theme === 'dark' ? 'ds-dark' : 'ds-light'

  const handleMount: OnMount = (editor, monaco) => {
    registerDsThemes(monaco)
    monaco.editor.setTheme(monacoTheme)
    onMount?.(editor, monaco)
  }

  return (
    <div className={['ds-code-editor', className].filter(Boolean).join(' ')}>
      <Editor height={height} theme={monacoTheme} onMount={handleMount} {...props} />
    </div>
  )
}
