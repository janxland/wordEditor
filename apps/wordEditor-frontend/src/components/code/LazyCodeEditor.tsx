import React, { Suspense } from 'react';
import { Spin } from 'antd';
import type { CodeEditorProps } from './CodeEditor';

const CodeEditor = React.lazy(() =>
  import('./CodeEditor').then((m) => ({ default: m.CodeEditor })),
);

export const LazyCodeEditor: React.FC<CodeEditorProps> = (props) => (
  <Suspense
    fallback={
      <div className="editor-loading">
        <Spin tip="加载编辑器…" />
      </div>
    }
  >
    <CodeEditor {...props} />
  </Suspense>
);
