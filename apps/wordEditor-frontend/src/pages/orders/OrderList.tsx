/** 左栏：工单列表 —— 筛选、搜索、卡片。选中态与详情面板联动 */
import React from 'react';
import { Empty, Input, Segmented, Skeleton } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

import type { AuthUser, DocOrder } from '@/services/docOrder';
import { STATUS_META, TYPE_LABEL, formatAgo, needsMyAction, ownerLabel } from './model';

export interface FilterOption {
  value: string;
  label: string;
}

export const OrderList: React.FC<{
  items: DocOrder[];
  me: AuthUser | null;
  worker: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
  keyword: string;
  onKeyword: (v: string) => void;
  filter: string;
  onFilter: (v: string) => void;
  options: FilterOption[];
  empty: React.ReactNode;
}> = ({
  items,
  me,
  worker,
  selectedId,
  onSelect,
  loading,
  keyword,
  onKeyword,
  filter,
  onFilter,
  options,
  empty,
}) => (
  <section className="od-list">
    <div className="od-list-toolbar">
      <Input
        value={keyword}
        onChange={(e) => onKeyword(e.target.value)}
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜单号、标题、需求"
        aria-label="搜索工单"
      />
      <Segmented
        value={filter}
        onChange={(v) => onFilter(String(v))}
        options={options}
        block
        aria-label="按状态筛选"
      />
    </div>

    <div className="od-list-body">
      {loading && items.length === 0 && (
        <div className="od-list-skeleton">
          <Skeleton active paragraph={{ rows: 2 }} />
          <Skeleton active paragraph={{ rows: 2 }} />
          <Skeleton active paragraph={{ rows: 2 }} />
        </div>
      )}

      {!loading && items.length === 0 && <div className="od-list-empty">{empty}</div>}

      {items.map((order) => {
        const meta = STATUS_META[order.status];
        const todo = needsMyAction(order, me, worker);
        return (
          <button
            type="button"
            key={order.id}
            className={`od-card od-tone-${meta.tone}${order.id === selectedId ? ' is-selected' : ''}`}
            onClick={() => onSelect(order.id)}
            aria-current={order.id === selectedId}
          >
            <span className="od-card-bar" aria-hidden />
            <span className="od-card-main">
              <span className="od-card-top">
                <span className="od-no">{order.orderNo}</span>
                <span className="od-card-time">{formatAgo(order.updateTime)}</span>
              </span>
              <span className="od-card-title">{order.title}</span>
              <span className="od-card-foot">
                <span className="od-chip">{TYPE_LABEL[order.type]}</span>
                <span className="od-card-status">{meta.label}</span>
                <span className="od-dot" aria-hidden />
                <span className="od-card-owner">{ownerLabel(order, me)}</span>
                {/* 队列里看别人的单，得知道是谁下的 */}
                {order.customerId !== me?.userId && <span className="od-card-owner">{order.customerName} 下单</span>}
              </span>
            </span>
            {todo && <span className="od-todo">待你处理</span>}
          </button>
        );
      })}
    </div>

    {!loading && items.length > 0 && (
      <div className="od-list-foot">共 {items.length} 条</div>
    )}
  </section>
);

export const ListEmpty: React.FC<{ title: string; desc: string; action?: React.ReactNode }> = ({
  title,
  desc,
  action,
}) => (
  <Empty
    image={Empty.PRESENTED_IMAGE_SIMPLE}
    description={
      <span className="od-empty">
        <strong>{title}</strong>
        <em>{desc}</em>
      </span>
    }
  >
    {action}
  </Empty>
);
