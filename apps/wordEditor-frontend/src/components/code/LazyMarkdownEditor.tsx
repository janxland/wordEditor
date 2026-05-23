import React, { Suspense } from 'react';
import type { MarkdownEditorProps } from './MarkdownEditor';

const MarkdownEditor = React.lazy(() =>
  import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
);

export const LazyMarkdownEditor: React.FC<MarkdownEditorProps> = (props) => (
  <Suspense
    fallback={
      <div className="md-editor md-editor--loading">
        <div className="md-editor-skeleton" />
      </div>
    }
  >
    <MarkdownEditor {...props} />
  </Suspense>
);
