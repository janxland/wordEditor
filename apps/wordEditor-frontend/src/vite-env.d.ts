/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 部署形态：cloud=线上下单薄前端（只含工单中心），full=本地完整版 */
  readonly VITE_EDITION?: 'cloud' | 'full';
}
