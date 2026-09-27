/** 右栏：工单详情 —— 状态轨、需求、附件、动作区、流转记录 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Divider,
  Input,
  Modal,
  Space,
  Tag,
  Timeline,
  Tooltip,
} from 'antd';
import { CopyOutlined, DownloadOutlined, CloseOutlined } from '@ant-design/icons';

import type { AuthUser, DocOrder } from '@/services/docOrder';
import type { ActionPayload } from './useOrders';
import { AttachmentPicker } from './AttachmentPicker';
import { uploadAll } from './upload';
import {
  FLOW,
  STATUS_META,
  TYPE_LABEL,
  actionsOf,
  formatBytes,
  formatClock,
  isClosed,
  railIndex,
  type ActionKey,
  type OrderStatus,
} from './model';

const REWORK_PHRASES = ['目录页码对齐不对', '参考文献悬挂缩进缺失', '封面信息有误', '标题层级错乱'];

/**
 * 附件行。工单一终结（交付/取消）后端就把 COS 上的临时对象清空了，
 * 此时链接必然 404，别再渲染成可点的「下载」——直接标「已清理」。
 */
const AttachmentRow: React.FC<{
  att: DocOrder['attachments'][number];
  purged?: boolean;
}> = ({ att, purged }) => (
  <li className={`od-att${purged ? ' is-purged' : ''}`}>
    <span className="od-att-name" title={att.name}>
      {att.name}
    </span>
    <span className="od-att-meta">
      {purged ? (
        <>对象已随工单终结清理 · {att.uploadedBy}</>
      ) : (
        <>
          {formatBytes(att.size)} · {att.uploadedBy} · {formatClock(att.uploadedAt)}
        </>
      )}
    </span>
    {purged ? (
      <Tag className="od-att-tag">已清理</Tag>
    ) : (
      <Button type="link" size="small" href={att.url} target="_blank" rel="noreferrer" icon={<DownloadOutlined />}>
        下载
      </Button>
    )}
  </li>
);

export const OrderDetail: React.FC<{
  order: DocOrder;
  me: AuthUser | null;
  worker: boolean;
  busy: boolean;
  onAction: (key: ActionKey, order: DocOrder, payload?: ActionPayload) => Promise<void>;
  onClose?: () => void;
}> = ({ order, me, worker, busy, onAction, onClose }) => {
  const { message, modal } = App.useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [reworkNote, setReworkNote] = useState('');
  const [reworkOpen, setReworkOpen] = useState(false);
  const [uploadState, setUploadState] = useState<string | null>(null);

  // 切换工单时清空未提交的草稿，避免把 A 单的文件提交到 B 单
  useEffect(() => {
    setFiles([]);
    setNote('');
    setReworkNote('');
  }, [order.id]);

  const meta = STATUS_META[order.status];
  const actions = actionsOf(order, me, worker);
  const can = (key: ActionKey): boolean => actions.some((a) => a.key === key);
  const reqAtts = order.attachments.filter((a) => a.kind === 'requirement');
  const delivAtts = order.attachments.filter((a) => a.kind === 'deliverable');
  // 交付/取消时后端 purgeOrderObjects 会清空 COS 对象，此时链接已经取不到了
  const terminal = order.status === 'delivered' || isClosed(order.status);
  const pending = busy || uploadState !== null;

  const copyNo = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(order.orderNo);
      message.success('单号已复制');
    } catch {
      message.info(order.orderNo);
    }
  };

  const confirm = (title: string, content: React.ReactNode, ok: () => Promise<void>, danger = false): void => {
    modal.confirm({
      title,
      content,
      okText: '确定',
      cancelText: '再想想',
      okButtonProps: { danger },
      onOk: ok,
    });
  };

  const doSubmit = (): void => {
    if (files.length === 0) {
      message.warning('先选择至少一个交付文件');
      return;
    }
    confirm(
      `提交 ${files.length} 个文件给下单人确认？`,
      <span>
        {files.map((f) => f.name).join('、')}
        {note.trim() ? `　备注：${note.trim()}` : ''}
      </span>,
      async () => {
        setUploadState('准备上传…');
        try {
          const attachments = await uploadAll(files, (done, total, name) =>
            setUploadState(`上传中 ${done}/${total} · ${name}`),
          );
          await onAction('submit', order, { note: note.trim() || undefined, attachments });
          setFiles([]);
          setNote('');
        } finally {
          setUploadState(null);
        }
      },
    );
  };

  return (
    <article className={`od-detail od-tone-${meta.tone}`}>
      <header className="od-detail-head">
        <div className="od-detail-headline">
          <div className="od-detail-meta">
            <button type="button" className="od-no od-no-btn" onClick={copyNo} title="复制单号">
              {order.orderNo}
              <CopyOutlined />
            </button>
            <Tag className={`od-tag-status od-tone-${meta.tone}`}>{meta.label}</Tag>
            <span className="od-chip">{TYPE_LABEL[order.type]}</span>
          </div>
          <h2 className="od-detail-title">{order.title}</h2>
        </div>
        {onClose && (
          <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="关闭详情" />
        )}
      </header>

      {!isClosed(order.status) && (
        <div className="od-rail">
          {FLOW.map((s, i) => {
            const cur = railIndex(order.status);
            const state = order.status === 'delivered' || i < cur ? 'done' : i === cur ? 'now' : 'next';
            const label =
              i === cur && order.status === 'rework' ? STATUS_META.rework.label : STATUS_META[s].label;
            return (
              <div key={s} className={`od-rail-node is-${state}`}>
                <span className="od-rail-mark" aria-hidden />
                <span className="od-rail-label">{label}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="od-rail-hint">{meta.hint}</p>

      <section className="od-block">
        <h3 className="od-block-title">需求</h3>
        <p className={`od-requirement${order.requirement ? '' : ' is-empty'}`}>
          {order.requirement || '下单时没写具体要求'}
        </p>
        <dl className="od-facts">
          <div>
            <dt>下单人</dt>
            <dd>{order.customerName}</dd>
          </div>
          <div>
            <dt>制作人</dt>
            <dd>{order.workerName ?? '未分配'}</dd>
          </div>
          <div>
            <dt>下单</dt>
            <dd>{formatClock(order.createTime)}</dd>
          </div>
          <div>
            <dt>更新</dt>
            <dd>{formatClock(order.updateTime)}</dd>
          </div>
        </dl>
      </section>

      <section className="od-block">
        <h3 className="od-block-title">附件</h3>
        {reqAtts.length === 0 && delivAtts.length === 0 && (
          <p className="od-muted">暂无附件</p>
        )}
        {reqAtts.length > 0 && (
          <>
            <p className="od-att-label">需求附件</p>
            <ul className="od-att-list">
              {reqAtts.map((a) => (
                <AttachmentRow key={a.id} att={a} purged={terminal} />
              ))}
            </ul>
          </>
        )}
        {delivAtts.length > 0 && (
          <>
            <p className="od-att-label">
              交付附件
              {delivAtts.length > 1 && !terminal && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => delivAtts.forEach((a) => window.open(a.url, '_blank'))}
                >
                  全部下载
                </Button>
              )}
            </p>
            <ul className="od-att-list">
              {delivAtts.map((a) => (
                <AttachmentRow key={a.id} att={a} purged={terminal} />
              ))}
            </ul>
          </>
        )}
        {order.status === 'delivered' && (
          <Alert
            className="od-note"
            type="info"
            showIcon
            message="工单已完成，服务端已清空该单的临时文件 —— 需要留档请提前下载"
          />
        )}
        {order.status === 'checking' && delivAtts.length > 0 && (
          <Alert
            className="od-note"
            type="warning"
            showIcon
            message="确认完成后临时文件会被清理，请先下载再看"
          />
        )}
      </section>

      {actions.length > 0 && (
        <section className="od-actions">
          {can('submit') && (
            <div className="od-submit">
              <AttachmentPicker files={files} onChange={setFiles} disabled={pending} tip="交付文件至少 1 个" />
              <Input.TextArea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="给下单人的说明（可选）：改了什么、还有什么没做"
              />
              <Button type="primary" disabled={files.length === 0} loading={pending} onClick={doSubmit}>
                {uploadState ?? '提交检查'}
              </Button>
            </div>
          )}
          <Space wrap className="od-actions-row">
            {can('accept') && (
              <Tooltip title={actions.find((a) => a.key === 'accept')?.hint}>
                <Button
                  type="primary"
                  loading={busy}
                  onClick={() =>
                    confirm(
                      '接下这张工单？',
                      `《${order.title}》将归入你的制作列表，状态进入制作中。`,
                      () => onAction('accept', order),
                    )
                  }
                >
                  接单
                </Button>
              </Tooltip>
            )}
            {can('deliver') && (
              <Button
                type="primary"
                loading={busy}
                onClick={() =>
                  confirm(
                    '确认交付完成？',
                    '确认后工单关闭，无法再要求返工。',
                    () => onAction('deliver', order),
                  )
                }
              >
                确认完成
              </Button>
            )}
            {can('rework') && (
              <Button danger loading={busy} onClick={() => setReworkOpen(true)}>
                要求返工
              </Button>
            )}
            {can('cancel') && (
              <Button
                danger
                loading={busy}
                onClick={() =>
                  confirm(
                    '取消这张工单？',
                    '取消后不可恢复，已上传的参考文件会被清理。',
                    () => onAction('cancel', order),
                    true,
                  )
                }
              >
                取消工单
              </Button>
            )}
          </Space>
        </section>
      )}

      <Divider className="od-divider" />
      <section className="od-block">
        <h3 className="od-block-title">流转记录</h3>
        {order.timeline.length === 0 ? (
          <p className="od-muted">暂无记录</p>
        ) : (
          <Timeline
            items={order.timeline.map((t) => {
              const tm = STATUS_META[t.status as OrderStatus];
              return {
                dot: <span className={`od-tl-dot od-tone-${tm?.tone ?? 'grey'}`} />,
                children: (
                  <div className="od-tl">
                    <div className="od-tl-top">
                      <strong>{tm?.label ?? t.status}</strong>
                      <span className="od-muted">{t.by}</span>
                      <span className="od-muted">{formatClock(t.at)}</span>
                    </div>
                    {t.note && <div className="od-tl-note">{t.note}</div>}
                  </div>
                ),
              };
            })}
          />
        )}
      </section>

      <Modal
        open={reworkOpen}
        title="要求返工"
        okText="退回返工"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: reworkNote.trim().length === 0 }}
        onOk={async () => {
          await onAction('rework', order, { note: reworkNote.trim() });
          setReworkOpen(false);
          setReworkNote('');
        }}
        onCancel={() => setReworkOpen(false)}
        destroyOnClose
      >
        <p className="od-modal-lead">写明要改什么，制作员打开工单就能看到这段话。</p>
        <Input.TextArea
          rows={4}
          value={reworkNote}
          onChange={(e) => setReworkNote(e.target.value)}
          maxLength={500}
          showCount
          placeholder="例如：目录页码右对齐、参考文献缩进不对、封面学院名称写错"
        />
        <Space wrap style={{ marginTop: 8 }}>
          {REWORK_PHRASES.map((p) => (
            <Button key={p} size="small" onClick={() => setReworkNote((v) => (v ? `${v}；${p}` : p))}>
              {p}
            </Button>
          ))}
        </Space>
      </Modal>
    </article>
  );
};
