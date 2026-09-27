/** 附件选择器：只挑文件不自动上传，随工单/提交动作一起发出去 */
import React from 'react';
import { App, Button, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

import { MAX_FILES, MAX_FILE_BYTES } from './upload';

const uidOf = (index: number): string => `f${index}`;

export const AttachmentPicker: React.FC<{
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
  disabled?: boolean;
  tip?: React.ReactNode;
}> = ({ files, onChange, max = MAX_FILES, disabled, tip }) => {
  const { message } = App.useApp();

  const beforeUpload = (file: File): false | typeof Upload.LIST_IGNORE => {
    if (file.size > MAX_FILE_BYTES) {
      message.error(`${file.name} 超过 50MB，压缩或拆分后再传`);
      return Upload.LIST_IGNORE;
    }
    if (files.length >= max) {
      message.error(`最多 ${max} 个附件，先移除一个再选`);
      return Upload.LIST_IGNORE;
    }
    if (files.some((f) => f.name === file.name && f.size === file.size)) {
      message.warning(`${file.name} 已在列表里`);
      return Upload.LIST_IGNORE;
    }
    onChange([...files, file]);
    return false;
  };

  return (
    <div className="od-picker">
      <Upload
        multiple
        disabled={disabled}
        beforeUpload={beforeUpload}
        showUploadList
        fileList={files.map((f, i) => ({
          uid: uidOf(i),
          name: f.name,
          size: f.size,
          status: 'done' as const,
        }))}
        onRemove={(f) => onChange(files.filter((_, i) => uidOf(i) !== f.uid))}
      >
        <Button icon={<InboxOutlined />} disabled={disabled || files.length >= max}>
          选择文件
        </Button>
      </Upload>
      <div className="od-picker-tip">
        {tip ?? `单个不超过 50MB，最多 ${max} 个 —— 选定后随提交一起上传`}
      </div>
    </div>
  );
};
