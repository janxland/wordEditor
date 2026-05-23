import React, { useMemo } from 'react';
import { CodeEditor } from './CodeEditor';

function countStats(text: string): { lines: number; chars: number } {
  const lines = text.length === 0 ? 1 : text.split('\n').length;
  return { lines, chars: text.length };
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  path?: string;
  className?: string;
}

/** 导出页 Markdown 写作区：轻顶栏 + 留白编辑器 */
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  readOnly,
  path = 'document.md',
  className,
}) => {
  const stats = useMemo(() => countStats(value), [value]);

  return (
    <div className={['md-editor', className].filter(Boolean).join(' ')}>
      <header className="md-editor-bar">
        <span className="md-editor-bar-title">{path}</span>
        <span className="md-editor-bar-stats">
          {stats.lines} 行 · {stats.chars.toLocaleString()} 字
        </span>
      </header>
      <div className="md-editor-surface">
        <CodeEditor
          variant="markdown"
          language="markdown"
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          path={path}
          height="100%"
          autoFocus
        />
      </div>
    </div>
  );
};
