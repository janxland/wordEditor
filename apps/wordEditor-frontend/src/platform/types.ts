import type { ComponentType, LazyExoticComponent } from 'react';

/** 功能模块元数据 —— 低代码/无代码时可由配置动态注册 */
export interface FeatureModule {
  id: string;
  path: string;
  label: string;
  /** Ant Design icon 名称或自定义，由 Shell 解析 */
  icon: string;
  order: number;
  /** 是否在主导航显示 */
  nav?: boolean;
  /** 导航分组：顾客服务（下单人）/ 制作工具（制作人）/ 其他 */
  group?: 'customer' | 'make' | 'meta';
  /**
   * 访问级别（导航与路由双重过滤，缺省 public）：
   * - public：所有人可见（下单人视角功能）
   * - worker：仅制作员 / 超级管理员可见（制作工具，含模板等能力）
   * - admin：仅超级管理员可见（技术实现类页面）
   */
  access?: 'public' | 'worker' | 'admin';
  lazy: LazyExoticComponent<ComponentType>;
}
