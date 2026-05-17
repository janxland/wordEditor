import { HttpBuildPipeline } from './HttpBuildPipeline';
import type { IBuildPipeline } from './IBuildPipeline';

let pipeline: IBuildPipeline | null = null;

export function getBuildPipeline(): IBuildPipeline {
  if (!pipeline) pipeline = new HttpBuildPipeline();
  return pipeline;
}

export function setBuildPipeline(p: IBuildPipeline): void {
  pipeline = p;
}

export type { IBuildPipeline } from './IBuildPipeline';
export * from './types';
export { fetchToolsStatus, type ToolsStatus, type ToolCheck } from './toolsStatus';
