import React, { useCallback, useRef } from 'react';
import Editor, { type EditorProps, type OnMount } from '@monaco-editor/react';
import { ensureCodeTheme, ensureMarkdownTheme } from './monacoTheme';
import { editorOptions, editorTheme, shellClass, type EditorVariant } from './editorPresets';

export type CodeLanguage = 'yaml' | 'lua' | 'vb' | 'markdown';

const LANG_MAP: Record<CodeLanguage, string> = {
  yaml: 'yaml',
  lua: 'lua',
  vb: 'vb',
  markdown: 'markdown',
};

export interface CodeEditorProps {
  value: string;
  language: CodeLanguage;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string | number;
  path?: string;
  /** markdown：浅色写作模式；code：深色代码模式 */
  variant?: EditorVariant;
  autoFocus?: boolean;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  language,
  onChange,
  readOnly = false,
  height = '100%',
  path,
  variant = language === 'markdown' ? 'markdown' : 'code',
  autoFocus = false,
}) => {
  const mounted = useRef(false);

  const onMount = useCallback<OnMount>(
    (editor, monaco) => {
      if (variant === 'markdown') {
        ensureMarkdownTheme(monaco);
      } else {
        ensureCodeTheme(monaco);
      }
      monaco.editor.setTheme(editorTheme(variant));
      if (autoFocus && !mounted.current) {
        editor.focus();
        mounted.current = true;
      }
    },
    [variant, autoFocus],
  );

  return (
    <div className={shellClass(variant, language)}>
      <Editor
        height={height}
        language={LANG_MAP[language]}
        path={path}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={onMount}
        theme={editorTheme(variant)}
        options={editorOptions(variant, readOnly) as EditorProps['options']}
      />
    </div>
  );
};
