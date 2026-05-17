import React from 'react';
import { Form, InputNumber, Select, Switch, Input, Space, Typography } from 'antd';
import type { FieldMeta } from '@/core/dsl-schema';
import { PARAGRAPH_FIELDS, RUN_FIELDS } from '@/core/dsl-schema';
import type { ParagraphProps, RunProps } from '@/core/types';

const { Text } = Typography;

function renderField(
  meta: FieldMeta,
  value: unknown,
  onChange: (key: string, val: unknown) => void,
) {
  switch (meta.type) {
    case 'bool':
      return (
        <Switch
          checked={!!value}
          onChange={(c) => onChange(meta.key, c)}
          size="small"
        />
      );
    case 'number':
      return (
        <InputNumber
          value={value as number | undefined}
          onChange={(n) => onChange(meta.key, n ?? undefined)}
          min={meta.min}
          max={meta.max}
          style={{ width: '100%' }}
          placeholder="—"
        />
      );
    case 'select':
      return (
        <Select
          allowClear
          value={value as string | undefined}
          onChange={(v) => onChange(meta.key, v)}
          options={meta.options}
          placeholder="默认"
          style={{ width: '100%' }}
        />
      );
    case 'font':
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => onChange(meta.key, e.target.value || undefined)}
          placeholder="inherit 或字体名"
          allowClear
        />
      );
    default:
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => onChange(meta.key, e.target.value || undefined)}
          allowClear
        />
      );
  }
}

interface PropsGroupProps<T> {
  title: string;
  fields: FieldMeta[];
  value?: T;
  onChange: (next: T) => void;
}

function PropsGroup<T extends object>({
  title,
  fields,
  value = {} as T,
  onChange,
}: PropsGroupProps<T>) {
  const patch = (key: string, val: unknown) => {
    const next = { ...value } as Record<string, unknown>;
    if (val === undefined || val === '' || val === null) {
      delete next[key];
    } else {
      next[key] = val;
    }
    onChange(next as T);
  };

  return (
    <div className="dsl-props-group">
      <Text strong className="dsl-props-title">
        {title}
      </Text>
      <Form layout="vertical" size="small" className="dsl-props-form">
        {fields.map((meta) => (
          <Form.Item
            key={meta.key}
            label={
              <Space size={4}>
                <span>{meta.label}</span>
                {meta.hint && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {meta.hint}
                  </Text>
                )}
              </Space>
            }
          >
            {renderField(meta, (value as Record<string, unknown>)[meta.key], patch)}
          </Form.Item>
        ))}
      </Form>
    </div>
  );
}

export const ParagraphFieldsForm: React.FC<{
  value?: ParagraphProps;
  onChange: (v: ParagraphProps) => void;
}> = ({ value, onChange }) => (
  <PropsGroup title="段落 (paragraph)" fields={PARAGRAPH_FIELDS} value={value} onChange={onChange} />
);

export const RunFieldsForm: React.FC<{
  value?: RunProps;
  onChange: (v: RunProps) => void;
}> = ({ value, onChange }) => (
  <PropsGroup title="字符 (run)" fields={RUN_FIELDS} value={value} onChange={onChange} />
);
