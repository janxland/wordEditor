/** 后处理阶段共享上下文：一次构建里所有阶段都基于它。 */
import type { DocxProvenance } from '../metadata.js';
import type { ResolvedTemplate } from '../templates.js';
import type { BuildOptions, StepId, StepStatus } from '../types.js';

export type StageName =
  | 'document'
  | 'styles'
  | 'threeLine'
  | 'verbatim'
  | 'headerFooter'
  | 'password'
  | 'metadata';

export interface StageContext {
  repoRoot: string;
  /** 就地改写的目标 docx。 */
  docxPath: string;
  template: ResolvedTemplate;
  options: BuildOptions;
  provenance?: DocxProvenance;
  /** 样式预览传入的临时 styles.yaml；undefined 表示用模板自带的。 */
  stylesYaml?: string | null;
  skipRefs?: boolean;
  log: (line: string, stream?: 'stdout' | 'stderr') => void;
  step: (id: StepId, status: StepStatus, message?: string) => void;
}
