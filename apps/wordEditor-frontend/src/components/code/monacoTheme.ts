import type { Monaco } from '@monaco-editor/react';

let mdThemeReady = false;
let codeThemeReady = false;

/** 浅色写作主题：低对比、留白舒适 */
export function ensureMarkdownTheme(monaco: Monaco): void {
  if (mdThemeReady) return;
  monaco.editor.defineTheme('wordeditor-md', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'heading', foreground: '0f172a', fontStyle: 'bold' },
      { token: 'keyword', foreground: '4f46e5' },
      { token: 'string', foreground: '0d9488' },
      { token: 'comment', foreground: '94a3b8', fontStyle: 'italic' },
      { token: 'link', foreground: '2563eb' },
      { token: 'strong', fontStyle: 'bold' },
      { token: 'emphasis', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#fafbfc',
      'editor.foreground': '#334155',
      'editor.lineHighlightBackground': '#f1f5f9',
      'editorLineNumber.foreground': '#cbd5e1',
      'editorLineNumber.activeForeground': '#64748b',
      'editor.selectionBackground': '#c7d2fe66',
      'editor.inactiveSelectionBackground': '#e2e8f066',
      'editorCursor.foreground': '#4f46e5',
      'editorWhitespace.foreground': '#e2e8f0',
      'scrollbarSlider.background': '#cbd5e155',
      'scrollbarSlider.hoverBackground': '#94a3b888',
      'scrollbarSlider.activeBackground': '#64748b99',
    },
  });
  mdThemeReady = true;
}

export function ensureCodeTheme(monaco: Monaco): void {
  if (codeThemeReady) return;
  monaco.editor.defineTheme('wordeditor-code', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e1e2e',
    },
  });
  codeThemeReady = true;
}
