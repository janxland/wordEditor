import React, { useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';

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
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  language,
  onChange,
  readOnly = false,
  height = '100%',
  path,
}) => {
  const onMount = useCallback<OnMount>((editor) => {
    editor.focus();
  }, []);

  return (
    <Editor
      height={height}
      language={LANG_MAP[language]}
      path={path}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={onMount}
      theme="vs-dark"
      options={{
        readOnly,
        minimap: { enabled: true },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        tabSize: 2,
        formatOnPaste: true,
      }}
    />
  );
};
