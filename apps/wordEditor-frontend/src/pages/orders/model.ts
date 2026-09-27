/**
 * 工单领域模型 —— 状态语义、可执行动作、时间与体积格式化。
 * 只放纯函数：状态判断与文案一律从这里取，避免散落到各个组件里各写一份。
 */
import { isWorker, type AuthUser, type DocOrder } from '@/services/docOrder';

export type OrderStatus = DocOrder['status'];

/** 视觉色调：一个状态一个色，只用于状态轨 / 标签 / 卡片色条，不做装饰 */
export type Tone = 'blue' | 'amber' | 'teal' | 'red' | 'green' | 'grey';

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** 这个状态下「下一步是谁、做什么」的一句话，直接进 UI */
  hint: string;
}

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  placed: { label: '已下单', tone: 'blue', hint: '等待制作员接单，此时可以直接取消' },
  producing: { label: '制作中', tone: 'amber', hint: '制作员正在产出，完成后会提交给你确认' },
  checking: { label: '待确认', tone: 'teal', hint: '先下载交付文件确认，不满意就写明原因要求返工' },
  rework: { label: '返工中', tone: 'red', hint: '已退回，等制作员按你的说明重新提交' },
  delivered: { label: '已完成', tone: 'green', hint: '工单已闭环，临时附件已清理' },
  cancelled: { label: '已取消', tone: 'grey', hint: '工单已终止' },
};

export const TONE_HEX: Record<Tone, string> = {
  blue: '#2563eb',
  amber: '#d97706',
  teal: '#0e7490',
  red: '#dc2626',
  green: '#15803d',
  grey: '#64748b',
};

export const TYPE_LABEL: Record<DocOrder['type'], string> = {
  template: '模板制作',
  document: '文档产出',
};

/** 主流程四站；返工挂在「待确认」之前，不单独占一站 */
export const FLOW: OrderStatus[] = ['placed', 'producing', 'checking', 'delivered'];

/** 状态在主流程上的位置 */
export function railIndex(status: OrderStatus): number {
  if (status === 'rework') return 2;
  const i = FLOW.indexOf(status);
  return i === -1 ? 0 : i;
}

/** 已终止的工单不画流程轨 */
export function isClosed(status: OrderStatus): boolean {
  return status === 'cancelled';
}

// ---------------------------------------------------------------- 动作

export type ActionKey = 'accept' | 'submit' | 'deliver' | 'rework' | 'cancel';

export interface ActionMeta {
  key: ActionKey;
  label: string;
  kind: 'primary' | 'default' | 'danger';
  /** 按钮旁的解释，说明这一步会发生什么 */
  hint: string;
}

const ACTION_META: Record<ActionKey, Omit<ActionMeta, 'key'>> = {
  accept: { label: '接单', kind: 'primary', hint: '接单后工单归你，状态进入制作中' },
  submit: { label: '提交检查', kind: 'primary', hint: '上传交付文件后提交，等待下单人确认' },
  deliver: { label: '确认完成', kind: 'primary', hint: '确认后工单关闭，临时附件会被清理' },
  rework: { label: '要求返工', kind: 'danger', hint: '退回给制作员，需要写明修改要求' },
  cancel: { label: '取消工单', kind: 'danger', hint: '只有未被接单的工单可以取消' },
};

/**
 * 当前用户对这张单能做什么。动作权限与后端 routes.ts 的校验保持一致，
 * 前端只做「显示与否」，不做安全边界。
 */
export function actionsOf(order: DocOrder, me: AuthUser | null, worker: boolean): ActionMeta[] {
  if (!me || isClosed(order.status) || order.status === 'delivered') return [];
  const mine = order.customerId === me.userId;
  const myJob = order.workerId === me.userId;
  const out: ActionKey[] = [];

  if (worker && order.status === 'placed') out.push('accept');
  if (worker && myJob && (order.status === 'producing' || order.status === 'rework')) out.push('submit');
  if (mine && order.status === 'placed') out.push('cancel');
  if (mine && order.status === 'checking') out.push('deliver', 'rework');

  return out.map((key) => ({ key, ...ACTION_META[key] }));
}

/** 这张单正在等我动手 —— 列表排序与默认选中都靠它 */
export function needsMyAction(order: DocOrder, me: AuthUser | null, worker: boolean): boolean {
  return actionsOf(order, me, worker).length > 0;
}

/** 列表里「谁在负责」的一句话 */
export function ownerLabel(order: DocOrder, me: AuthUser | null): string {
  if (order.workerName) return order.workerId === me?.userId ? '我负责' : `制作员 ${order.workerName}`;
  return '待接单';
}

// ---------------------------------------------------------------- 格式化

/** MySQL 的 `2026-09-26 10:00:00.000` 在 Safari 下不是合法 ISO，统一补 T */
export function parseTime(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 09-26 14:03 */
export function formatClock(value: string): string {
  const d = parseTime(value);
  if (!d) return '—';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 刚刚 / 5 分钟前 / 3 小时前 / 09-26 14:03 */
export function formatAgo(value: string): string {
  const d = parseTime(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatClock(value);
}

export function formatBytes(size?: number | null): string {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function isWorkerUser(user: AuthUser | null): boolean {
  return isWorker(user);
}
