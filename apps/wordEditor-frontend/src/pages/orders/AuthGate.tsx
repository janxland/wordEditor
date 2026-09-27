/** 未登录引导屏：先说清这地方能干什么，再要账号 */
import React from 'react';
import { Card } from 'antd';

import type { AuthUser } from '@/services/docOrder';
import { AuthForm } from '@/components/auth/AuthForm';

const STEPS = [
  { title: '下单', desc: '写明格式要求与参考文件，拿到工单号' },
  { title: '制作员接单产出', desc: '接单后提交交付文件，状态同步更新' },
  { title: '你下载确认', desc: '满意就确认完成，不满意写明原因要求返工' },
];

export const AuthGate: React.FC<{ onAuthed: (u: AuthUser) => void }> = ({ onAuthed }) => {
  return (
    <div className="od-gate">
      <div className="od-gate-intro">
        <h1 className="od-gate-title">工单中心</h1>
        <p className="od-gate-lead">
          把排版、模板这类自己做不动的活交给制作员：下单、传参考文件、盯进度、收成品，
          全流程都有记录。
        </p>
        <ol className="od-gate-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="od-gate-step-no">{String(i + 1).padStart(2, '0')}</span>
              <span>
                <strong>{s.title}</strong>
                <em>{s.desc}</em>
              </span>
            </li>
          ))}
        </ol>
        <p className="od-gate-note">制作员需要 doc-worker 角色，账号由管理员开通。</p>
      </div>

      <Card className="od-gate-card">
        <AuthForm onAuthed={onAuthed} />
      </Card>
    </div>
  );
};
