import type { BuildRequest, BuildResponse } from './types';

/** 构建管线抽象 —— 本地 dev API / 远程服务 / 队列 worker 可互换 */
export interface IBuildPipeline {
  readonly id: string;
  build(request: BuildRequest): Promise<BuildResponse>;
  healthCheck?(): Promise<boolean>;
}
