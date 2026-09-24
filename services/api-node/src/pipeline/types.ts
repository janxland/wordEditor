/** 构建入参与流式事件契约。 */
export interface BuildOptions {
  noHtmlPipe?: boolean;
  noPostprocess?: boolean;
  /** Word「修改密码」（writeProtection），空则不设置。 */
  password?: string;
  headerText?: string;
  headerAlign?: string;
  headerVerticalAlign?: string;
  footerText?: string;
  footerAlign?: string;
  footerVerticalAlign?: string;
}

export type StepId = 'prepare' | 'pandoc' | 'structure' | 'ooxml';

export type StepStatus = 'wait' | 'process' | 'finish';

export type PipelineEvent =
  | { type: 'step'; id: StepId; status: StepStatus; message?: string }
  | { type: 'log'; line: string; stream: 'stdout' | 'stderr' };
