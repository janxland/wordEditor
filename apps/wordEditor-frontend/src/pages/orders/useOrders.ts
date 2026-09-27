/**
 * 工单数据控制器：登录态、两个列表、轮询刷新、状态流转动作。
 * 所有网络副作用收在这里，页面组件只负责渲染与调用。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';

import {
  currentUser,
  docOrderApi,
  isWorker,
  logout,
  type AuthUser,
  type DocOrder,
} from '@/services/docOrder';
import type { ActionKey } from './model';
import type { PendingAttachment } from './upload';

/** 轮询间隔：工单是低频协作场景，20 秒足够，切到后台标签页时不打接口 */
const POLL_MS = 20_000;

const DONE_TEXT: Record<ActionKey, string> = {
  accept: '已接单，工单进入制作中',
  submit: '已提交，等待下单人确认',
  deliver: '工单已完成，临时附件已清理',
  rework: '已退回，制作员会看到你的修改要求',
  cancel: '工单已取消',
};

export interface ActionPayload {
  note?: string;
  attachments?: PendingAttachment[];
}

export function useOrdersController() {
  const { message } = App.useApp();
  const [me, setMe] = useState<AuthUser | null>(() => currentUser());
  const [orders, setOrders] = useState<DocOrder[]>([]);
  const [queue, setQueue] = useState<DocOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!currentUser()) return;
    if (!silent) setLoading(true);
    try {
      const mine = docOrderApi.my();
      const q = isWorker(currentUser())
        ? docOrderApi.queue().catch(() => [] as DocOrder[])
        : Promise.resolve([] as DocOrder[]);
      const [mineList, queueList] = await Promise.all([mine, q]);
      setOrders(mineList);
      setQueue(queueList);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const signOut = useCallback(() => {
    logout();
    setMe(null);
    setOrders([]);
    setQueue([]);
  }, []);

  // 监听必须常驻：未登录时也要接得住登录事件，否则登录完列表不会自己加载
  useEffect(() => {
    const onAuthChanged = () => {
      setMe(currentUser());
      void refresh();
    };
    window.addEventListener('wordeditor.auth-changed', onAuthChanged);
    return () => window.removeEventListener('wordeditor.auth-changed', onAuthChanged);
  }, [refresh]);

  // 换人 / 登录后才拉一次全量，之后交给轮询；loadedFor 挡掉登录时的重复请求
  const loadedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!me) {
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current !== me.userId) {
      loadedFor.current = me.userId;
      void refresh();
    }
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [me, refresh]);

  /** 状态流转：成功提示 + 静默刷新，失败只报错不刷新 */
  const runAction = useCallback(
    async (key: ActionKey, order: DocOrder, payload: ActionPayload = {}): Promise<DocOrder | null> => {
      let updated: DocOrder | null = null;
      try {
        switch (key) {
          case 'accept':
            updated = await docOrderApi.accept(order.id);
            break;
          case 'submit':
            updated = await docOrderApi.submit(order.id, {
              note: payload.note,
              attachments: payload.attachments,
            });
            break;
          case 'deliver':
            updated = await docOrderApi.deliver(order.id);
            break;
          case 'rework':
            updated = await docOrderApi.rework(order.id, payload.note ?? '');
            break;
          case 'cancel':
            updated = await docOrderApi.cancel(order.id);
            break;
        }
        message.success(DONE_TEXT[key]);
        await refresh(true);
      } catch (e) {
        message.error((e as Error).message);
        return null;
      }
      // 把流转后的单交回去：调用方要据此保证它没被当前筛选挡住
      return updated;
    },
    [message, refresh],
  );

  return { me, setMe, orders, queue, loading, error, updatedAt, refresh, signOut, runAction };
}
