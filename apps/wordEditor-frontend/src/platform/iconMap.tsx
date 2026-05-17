import {
  AppstoreOutlined,
  BookOutlined,
  CodeOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  export: <ExportOutlined />,
  templates: <AppstoreOutlined />,
  vba: <CodeOutlined />,
  docs: <BookOutlined />,
};

export function resolveFeatureIcon(name: string): ReactNode {
  return ICONS[name] ?? <AppstoreOutlined />;
}
