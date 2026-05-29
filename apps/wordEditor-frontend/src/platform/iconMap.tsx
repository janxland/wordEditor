import {
  AppstoreOutlined,
  BookOutlined,
  ExportOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  export: <ExportOutlined />,
  import: <ImportOutlined />,
  templates: <AppstoreOutlined />,
  docs: <BookOutlined />,
};

export function resolveFeatureIcon(name: string): ReactNode {
  return ICONS[name] ?? <AppstoreOutlined />;
}
