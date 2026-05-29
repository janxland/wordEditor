import React, { useEffect, useMemo, useState } from 'react';
import { Empty, Image, List, Typography, Tag } from 'antd';
import type { ImportDocxEntry } from '@/kernel/pipeline';
import { entryToObjectUrl, guessMimeByExt } from '@/store/importStore';

const { Text } = Typography;

interface Props {
  entries: ImportDocxEntry[];
}

interface PreviewItem {
  entry: ImportDocxEntry;
  url: string;
  isImage: boolean;
}

/** 图片画廊 —— 列出从 docx 中抽出的全部 media，预览/下载，不丢内容 */
export const ImageGallery: React.FC<Props> = ({ entries }) => {
  const images = useMemo(
    () => entries.filter((e) => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(e.relPath)),
    [entries],
  );

  const [items, setItems] = useState<PreviewItem[]>([]);

  useEffect(() => {
    const list: PreviewItem[] = images.map((entry) => ({
      entry,
      url: entryToObjectUrl(entry, guessMimeByExt(entry.relPath)),
      isImage: true,
    }));
    setItems(list);
    return () => {
      list.forEach((it) => URL.revokeObjectURL(it.url));
    };
  }, [images]);

  if (items.length === 0) {
    return <Empty description="未抽取到图片" />;
  }

  return (
    <List
      grid={{ gutter: 12, xs: 1, sm: 2, md: 3, lg: 4 }}
      dataSource={items}
      renderItem={(it) => {
        const name = it.entry.relPath.split('/').pop() ?? it.entry.relPath;
        const sizeLabel =
          it.entry.size > 1024 * 1024
            ? `${(it.entry.size / 1024 / 1024).toFixed(1)} MB`
            : `${Math.round(it.entry.size / 1024)} KB`;
        return (
          <List.Item>
            <div className="image-card">
              <Image src={it.url} alt={name} style={{ width: '100%' }} />
              <div className="image-card-meta">
                <Text ellipsis style={{ maxWidth: '70%' }} title={it.entry.relPath}>
                  {name}
                </Text>
                <Tag>{sizeLabel}</Tag>
              </div>
              <a href={it.url} download={name} className="image-card-download">
                下载
              </a>
            </div>
          </List.Item>
        );
      }}
    />
  );
};
