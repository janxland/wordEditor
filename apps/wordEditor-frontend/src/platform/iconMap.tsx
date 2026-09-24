import {
  AppstoreOutlined,
  BookOutlined,
  ExportOutlined,
  ImportOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  export: <ExportOutlined />,
  import: <ImportOutlined />,
  templates: <AppstoreOutlined />,
  docs: <BookOutlined />,
  about: <InfoCircleOutlined />,
};

export function resolveFeatureIcon(name: string): ReactNode {
  return ICONS[name] ?? <AppstoreOutlined />;
}
