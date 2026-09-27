/**
 * 工单中心 —— 两栏受理台：左栏列表、右栏详情，动作与状态流转都在详情里完成。
 * 窄屏（<1024px）折成单列 + 详情抽屉。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Segmented, Space } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import { isWorker, currentUser, type DocOrder } from '@/services/docOrder';
import { AuthGate } from './AuthGate';
import { ListEmpty, OrderList, type FilterOption } from './OrderList';
import { OrderDetail } from './OrderDetail';
import { NewOrderDrawer } from './NewOrderDrawer';
import { formatClock, needsMyAction } from './model';
import { useOrdersController } from './useOrders';
import './orders.css';

type TabKey = 'mine' | 'queue';

const MINE_FILTERS: FilterOption[] = [
  { value: 'todo', label: '待我处理' },
  { value: 'active', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'all', label: '全部' },
];

const QUEUE_FILTERS: FilterOption[] = [
  { value: 'todo', label: '待我处理' },
  { value: 'open', label: '待接单' },
  { value: 'mine', label: '我负责' },
  { value: 'all', label: '全部' },
];

const isOpen = (o: DocOrder): boolean => o.status !== 'delivered' && o.status !== 'cancelled';

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export const OrdersPage: React.FC = () => {
  const { me, setMe, orders, queue, loading, error, updatedAt, refresh, signOut, runAction } =
    useOrdersController();
  const narrow = useIsNarrow();

  // 制作员的主战场是队列：登录即是制作员就落在「制作队列」；普通用户才看「我的工单」
  const [tab, setTab] = useState<TabKey>(() => (isWorker(currentUser()) ? 'queue' : 'mine'));
  // 默认不落在「待我处理」：工单一半时间是在等对方动手（制作员产出、下单人确认），
  // 停在 todo 会让它在轮到别人时凭空消失，看着像丢了
  const [mineFilter, setMineFilter] = useState('all');
  const [queueFilter, setQueueFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const source = tab === 'mine' ? orders : queue;
  const worker = isWorker(me);
  const filter = tab === 'mine' ? mineFilter : queueFilter;
  const setFilter = tab === 'mine' ? setMineFilter : setQueueFilter;

  /**
   * 筛选判定只写这一份 —— 列表渲染和「操作后保持可见」共用，
   * 不然两边各写一遍迟早不一致，又把刚操作完的单弄丢。
   */
  const matchFilter = (o: DocOrder, f: string): boolean => {
    if (tab === 'mine') {
      if (f === 'todo') return needsMyAction(o, me, worker);
      if (f === 'active') return isOpen(o);
      if (f === 'done') return o.status === 'delivered';
      return true;
    }
    if (f === 'todo') return needsMyAction(o, me, worker);
    if (f === 'open') return o.status === 'placed' && o.workerId == null;
    if (f === 'mine') return o.workerId === me?.userId;
    return true;
  };

  const list = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const hit = (o: DocOrder): boolean =>
      !k ||
      [o.orderNo, o.title, o.requirement, o.customerName, o.workerName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(k);

    const scoped = source.filter((o) => hit(o) && matchFilter(o, filter));

    // 等我动手的排前面，其余按最近更新
    return scoped.sort((a, b) => {
      const pa = needsMyAction(a, me, worker) ? 0 : 1;
      const pb = needsMyAction(b, me, worker) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.updateTime.localeCompare(a.updateTime);
    });
  }, [tab, orders, queue, keyword, filter, me, worker]);

  const selected = list.find((o) => o.id === selectedId) ?? null;

  // 选中项失效（切筛选 / 切标签 / 列表刷新）时，自动落到第一张待处理的单
  useEffect(() => {
    if (list.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && list.some((o) => o.id === selectedId)) return;
    setSelectedId((list.find((o) => needsMyAction(o, me, worker)) ?? list[0]).id);
  }, [list, selectedId, me, worker]);

  const stats = useMemo(() => {
    if (tab === 'mine') {
      return [
        { key: 'todo', label: '待我处理', value: source.filter((o) => needsMyAction(o, me, worker)).length },
        { key: 'active', label: '进行中', value: source.filter(isOpen).length },
        { key: 'done', label: '已完成', value: source.filter((o) => o.status === 'delivered').length },
      ];
    }
    return [
      { key: 'todo', label: '待我处理', value: source.filter((o) => needsMyAction(o, me, worker)).length },
      { key: 'open', label: '待接单', value: source.filter((o) => o.status === 'placed' && o.workerId == null).length },
      { key: 'mine', label: '我负责', value: source.filter((o) => o.workerId === me?.userId).length },
      { key: 'all', label: '在制总数', value: source.length },
    ];
  }, [tab, orders, queue, me, worker]);

  if (!me) return <AuthGate onAuthed={setMe} />;

  /** 流转后这张单多半已不属于原来的筛选，看不见就放宽到「全部」，别让它凭空消失 */
  const keepVisible = (order: DocOrder): void => {
    if (!matchFilter(order, filter)) setFilter('all');
    setSelectedId(order.id);
  };

  const act = async (
    key: Parameters<typeof runAction>[0],
    order: DocOrder,
    payload?: Parameters<typeof runAction>[2],
  ): Promise<void> => {
    setBusy(true);
    try {
      const next = await runAction(key, order, payload);
      if (next) keepVisible(next);
    } finally {
      setBusy(false);
    }
  };

  const emptyNode = keyword ? (
    <ListEmpty
      title="没有匹配的工单"
      desc="换个关键词试试，可以按单号、标题或需求内容搜"
      action={
        <Button size="small" onClick={() => setKeyword('')}>
          清空搜索
        </Button>
      }
    />
  ) : filter === 'todo' ? (
    // 大多数时候「没有待我处理」不等于「没有工单」——此刻只是轮到对方动手
    <ListEmpty
      title="当前没有等你处理的工单"
      desc="工单可能正在制作员那边产出，或已提交等你确认前先看一眼"
      action={
        <Button size="small" onClick={() => setFilter(tab === 'mine' ? 'active' : 'open')}>
          看进行中
        </Button>
      }
    />
  ) : worker && tab === 'mine' ? (
    // 制作员在「我的工单」里永远是空的（自己没下过单），别让人对着空屏找
    <ListEmpty
      title="你没有下过工单"
      desc="你是制作员，待接的活儿和正在负责的单都在「制作队列」里"
      action={
        <Button size="small" type="primary" onClick={() => setTab('queue')}>
          去制作队列
        </Button>
      }
    />
  ) : source.length > 0 ? (
    // 有数据但被当前筛选挡住了 —— 说「还没有工单」会和上面的计数自相矛盾
    <ListEmpty
      title="这一档里没有工单"
      desc="换「全部」就能看到，别以为单丢了"
      action={
        <Button size="small" onClick={() => setFilter('all')}>
          看全部
        </Button>
      }
    />
  ) : tab === 'mine' ? (
      <ListEmpty
        title="还没有工单"
        desc="点右上角新建工单，写清格式要求，制作员接单后进度会同步到这里"
        action={
          <Button size="small" type="primary" onClick={() => setNewOpen(true)}>
            新建工单
          </Button>
        }
      />
    ) : (
      <ListEmpty title="队列是空的" desc="暂时没有待接单的工单" />
    );

  return (
    <div className="od">
      <header className="od-top">
        <div>
          <h1 className="od-title">工单中心</h1>
          <p className="od-sub">
            {me.username} · {worker ? '制作员' : '下单人'}
            {updatedAt ? ` · 更新于 ${formatClock(new Date(updatedAt).toISOString())}` : ''}
          </p>
        </div>
        <Space wrap>
          {worker && (
            <Segmented
              value={tab}
              onChange={(v) => setTab(v as TabKey)}
              options={[
                { value: 'mine', label: '我的工单' },
                { value: 'queue', label: '制作队列' },
              ]}
            />
          )}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewOpen(true)}>
            新建工单
          </Button>
          <Button onClick={signOut}>退出</Button>
        </Space>
      </header>

      {error && (
        <Alert
          className="od-alert"
          type="error"
          showIcon
          message="工单数据没拉到"
          description={error}
          action={
            <Button size="small" onClick={() => void refresh()}>
              重试
            </Button>
          }
        />
      )}

      <div className="od-stats">
        {stats.map((s) => (
          <button
            type="button"
            key={s.key}
            className={`od-stat${filter === s.key ? ' is-active' : ''}`}
            onClick={() => setFilter(s.key)}
          >
            <span className="od-stat-value">{s.value}</span>
            <span className="od-stat-label">{s.label}</span>
          </button>
        ))}
      </div>

      <div className={`od-panes${narrow ? ' is-narrow' : ''}`}>
        <OrderList
          items={list}
          me={me}
          worker={worker}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          loading={loading}
          keyword={keyword}
          onKeyword={setKeyword}
          filter={filter}
          onFilter={setFilter}
          options={tab === 'mine' ? MINE_FILTERS : QUEUE_FILTERS}
          empty={emptyNode}
        />
        {!narrow && (
          <section className="od-detail-pane">
            {selected ? (
              <OrderDetail order={selected} me={me} worker={worker} busy={busy} onAction={act} />
            ) : (
              <div className="od-detail-blank">
                <p>左栏选一张工单</p>
                <span>需求、附件、流转记录和操作都会显示在这里</span>
              </div>
            )}
          </section>
        )}
      </div>

      {narrow && (
        <Drawer
          open={!!selected}
          onClose={() => setSelectedId(null)}
          width="100%"
          placement="right"
          title="工单详情"
          destroyOnHidden
        >
          {selected && (
            <OrderDetail
              order={selected}
              me={me}
              worker={worker}
              busy={busy}
              onAction={act}
              onClose={() => setSelectedId(null)}
            />
          )}
        </Drawer>
      )}

      <NewOrderDrawer
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          setNewOpen(false);
          setTab('mine');
          setMineFilter('all');
          void refresh(true).then(() => setSelectedId(id));
        }}
      />
    </div>
  );
};
