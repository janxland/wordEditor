import React, { Suspense } from 'react';
import type { CodeEditorProps } from './CodeEditor';

const CodeEditor = React.lazy(() =>
  import('./CodeEditor').then((m) => ({ default: m.CodeEditor })),
);

export const LazyCodeEditor: React.FC<CodeEditorProps> = (props) => (
  <Suspense
    fallback={
      <div className="editor-loading editor-loading--minimal">
        <div className="editor-loading-bar" />
      </div>
    }
  >
    <CodeEditor {...props} />
  </Suspense>
);
