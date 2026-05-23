import type { CodeLanguage } from './CodeEditor';

export type EditorVariant = 'code' | 'markdown';

const MONO =
  "'JetBrains Mono', 'Cascadia Code', 'SF Mono', 'Fira Code', Consolas, 'Courier New', monospace";

export function editorTheme(variant: EditorVariant): string {
  return variant === 'markdown' ? 'wordeditor-md' : 'wordeditor-code';
}

export function editorOptions(variant: EditorVariant, readOnly: boolean) {
  const shared = {
    readOnly,
    automaticLayout: true,
    scrollBeyondLastLine: variant === 'markdown',
    wordWrap: 'on' as const,
    tabSize: 2,
    formatOnPaste: variant === 'code',
    smoothScrolling: true,
    cursorBlinking: 'smooth' as const,
    cursorSmoothCaretAnimation: 'on' as const,
    renderWhitespace: 'none',
    bracketPairColorization: { enabled: variant === 'code' },
  };

  if (variant === 'markdown') {
    return {
      ...shared,
      fontSize: 14,
      lineHeight: 24,
      fontFamily: MONO,
      fontLigatures: true,
      padding: { top: 20, bottom: 28 },
      minimap: { enabled: false },
      lineNumbers: 'on' as const,
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 4,
      renderLineHighlight: 'line' as const,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: {
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        useShadows: false,
      },
      guides: { indentation: false, bracketPairs: false },
      stickyScroll: { enabled: false },
    };
  }

  return {
    ...shared,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: MONO,
    padding: { top: 12, bottom: 12 },
    minimap: { enabled: true, scale: 1, maxColumn: 72 },
    lineNumbers: 'on' as const,
    glyphMargin: true,
    folding: true,
    renderLineHighlight: 'all' as const,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
  };
}

export function shellClass(variant: EditorVariant, language: CodeLanguage): string {
  return ['code-editor-shell', `code-editor-shell--${variant}`, `code-editor-shell--${language}`]
    .filter(Boolean)
    .join(' ');
}
