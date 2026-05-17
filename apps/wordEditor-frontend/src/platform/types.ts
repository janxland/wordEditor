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
  lazy: LazyExoticComponent<ComponentType>;
}

/** 可插拔能力契约（后续无代码节点可映射到 capability） */
export interface CapabilityDescriptor {
  id: string;
  version: string;
  inputs: Record<string, 'string' | 'markdown' | 'file' | 'template' | 'boolean'>;
  outputs: Record<string, 'docx' | 'yaml' | 'json'>;
}
