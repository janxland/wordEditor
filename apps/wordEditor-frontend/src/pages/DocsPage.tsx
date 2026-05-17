import React, { useEffect, useState } from 'react';
import { Tabs, Spin, Typography } from 'antd';
import { LazyCodeEditor } from '@/components/code/LazyCodeEditor';
import { getStorage } from '@/services/storage';

const { Text } = Typography;

const DOCS = [
  { name: 'styles-dsl.md', label: '样式 DSL 规范' },
  { name: 'principle.md', label: '实现原理' },
];

export const DocsPage: React.FC = () => {
  const [active, setActive] = useState(DOCS[0].name);
  const [cache, setCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cache[active]) return;
    setLoading(true);
    getStorage()
      .readDoc(active)
      .then((content) => setCache((c) => ({ ...c, [active]: content })))
      .catch((e) => setCache((c) => ({ ...c, [active]: `加载失败：${e}` })))
      .finally(() => setLoading(false));
  }, [active, cache]);

  return (
    <div className="docs-page">
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        与仓库 docs/ 同步；修改请编辑源 Markdown 后刷新。
      </Text>
      <Tabs
        activeKey={active}
        onChange={setActive}
        items={DOCS.map((d) => ({ key: d.name, label: d.label }))}
      />
      {loading && !cache[active] ? (
        <Spin style={{ marginTop: 48 }} />
      ) : (
        <LazyCodeEditor
          language="markdown"
          value={cache[active] ?? ''}
          onChange={() => {}}
          readOnly
          height="calc(100vh - 180px)"
        />
      )}
    </div>
  );
};

