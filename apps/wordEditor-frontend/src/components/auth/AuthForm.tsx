/** 登录 / 注册表单 —— 工单页与外壳的登录弹窗共用这一份 */
import React, { useState } from 'react';
import { App, Button, Form, Input, Tabs } from 'antd';

import { login as apiLogin, register as apiRegister, type AuthUser } from '@/services/docOrder';

export const AuthForm: React.FC<{ onAuthed?: (user: AuthUser) => void }> = ({ onAuthed }) => {
  const { message } = App.useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const submit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      if (mode === 'login') {
        const user = await apiLogin(values.username, values.password);
        message.success('登录成功');
        onAuthed?.(user);
      } else {
        await apiRegister(values.username, values.password);
        message.success('注册成功，用同样的账号登录');
        setMode('login');
        form.setFieldValue('password', '');
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Tabs
        activeKey={mode}
        onChange={(k) => setMode(k as 'login' | 'register')}
        items={[
          { key: 'login', label: '登录' },
          { key: 'register', label: '注册' },
        ]}
      />
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '填用户名' }]}>
          <Input autoFocus autoComplete="username" placeholder="登录用的用户名" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}
        >
          <Input.Password
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'login' ? '登录密码' : '至少 6 位'}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          {mode === 'login' ? '登录' : '注册'}
        </Button>
      </Form>
    </>
  );
};
