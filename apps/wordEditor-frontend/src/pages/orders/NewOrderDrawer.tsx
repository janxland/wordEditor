/** 新建工单抽屉：类型 → 需求 → 参考附件 → 提交 */
import React, { useEffect, useState } from 'react';
import { App, Button, Drawer, Form, Input, Segmented, Space } from 'antd';

import { docOrderApi, type DocOrder } from '@/services/docOrder';
import { AttachmentPicker } from './AttachmentPicker';
import { uploadAll } from './upload';

const TYPE_OPTIONS = [
  { value: 'document', label: '文档产出' },
  { value: 'template', label: '模板制作' },
];

const TYPE_HINT: Record<string, string> = {
  document: '给我材料，我出成品文档（论文排版、报告整理…）',
  template: '给我一份样张，我做一套可复用的模板',
};

interface FormValues {
  type: DocOrder['type'];
  title: string;
  requirement?: string;
}

export const NewOrderDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: (orderId: number) => void;
}> = ({ open, onClose, onCreated }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [files, setFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<string | null>(null);
  // 类型提示跟着表单值走，不额外存一份状态
  const type = (Form.useWatch('type', form) ?? 'document') as DocOrder['type'];

  useEffect(() => {
    if (open) {
      form.resetFields();
      setFiles([]);
    }
  }, [open, form]);

  const submit = async (values: FormValues): Promise<void> => {
    setUploadState(files.length ? '准备上传…' : null);
    try {
      const attachments = files.length
        ? await uploadAll(files, (done, total, name) => setUploadState(`上传中 ${done}/${total} · ${name}`))
        : [];
      const order = await docOrderApi.create({
        ...values,
        requirement: values.requirement?.trim() ?? '',
        attachments,
      });
      message.success(`下单成功，单号 ${order.orderNo}`);
      onCreated(order.id);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUploadState(null);
    }
  };

  const busy = uploadState !== null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="新建工单"
      width={520}
      destroyOnClose
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="primary" loading={busy} onClick={() => form.submit()}>
            {uploadState ?? '提交订单'}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ type: 'document' }} requiredMark={false}>
        <Form.Item name="type" label="工单类型" rules={[{ required: true }]}>
          <Segmented block options={TYPE_OPTIONS} />
        </Form.Item>
        <p className="od-type-hint">{TYPE_HINT[type]}</p>

        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, min: 2, message: '至少 2 个字，说清楚要做什么' }]}
        >
          <Input placeholder="如：毕业论文排版（管科格式）" maxLength={80} showCount />
        </Form.Item>

        <Form.Item name="requirement" label="需求描述">
          <Input.TextArea
            rows={5}
            maxLength={1000}
            showCount
            placeholder={'格式要求、参考文件说明、交付物期望…\n写得越具体，返工越少'}
          />
        </Form.Item>

        <Form.Item label="参考附件">
          <AttachmentPicker files={files} onChange={setFiles} disabled={busy} tip="样张、素材、原始文档" />
        </Form.Item>
      </Form>
    </Drawer>
  );
};
