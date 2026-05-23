import type { BuildOptions } from './types';
import type { PipelineStepMeta } from './types';

export type BuildStepStatus = 'wait' | 'process' | 'finish' | 'error';

export interface BuildStepState {
  id: string;
  label: string;
  description?: string;
  status: BuildStepStatus;
  message?: string;
}

export function resolveActivePipelineSteps(options?: BuildOptions): PipelineStepMeta[] {
  const steps: PipelineStepMeta[] = [
    { id: 'prepare', label: '准备任务', description: '写入文稿与校验模板' },
    { id: 'pandoc', label: 'Pandoc 转换', description: 'Markdown → DOCX' },
  ];
  if (!options?.noPostprocess) {
    steps.push(
      { id: 'structure', label: '文档结构', description: '标题识别、交叉引用（OOXML）' },
      { id: 'ooxml', label: 'OOXML 样式', description: 'styles.yaml 注入' },
    );
  }
  return steps;
}

export function createInitialBuildSteps(options?: BuildOptions): BuildStepState[] {
  return resolveActivePipelineSteps(options).map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    status: 'wait' as const,
  }));
}

export function computeBuildPercent(steps: BuildStepState[]): number {
  if (steps.length === 0) return 0;
  let sum = 0;
  for (const s of steps) {
    if (s.status === 'finish') sum += 1;
    else if (s.status === 'process') sum += 0.55;
  }
  return Math.min(100, Math.round((sum / steps.length) * 100));
}
