/** MD → Word 管线请求/响应 —— 与后端 build API 对齐，便于替换实现 */

export interface BuildOptions {
  noHtmlPipe?: boolean;
  noPostprocess?: boolean;
  withFormulaMacro?: boolean;
  renderMath?: boolean;
}

export interface BuildRequest {
  markdown: string;
  templateId: string;
  fileName?: string;
  options?: BuildOptions;
}

export interface BuildSuccess {
  jobId: string;
  fileName: string;
  downloadUrl: string;
}

export interface BuildFailure {
  error: string;
  detail?: string;
  jobId?: string;
}

export type BuildResponse = BuildSuccess | BuildFailure;

export function isBuildSuccess(r: BuildResponse): r is BuildSuccess {
  return 'downloadUrl' in r && typeof (r as BuildSuccess).downloadUrl === 'string';
}

/** 管线步骤（面向未来低代码编排可视化） */
export interface PipelineStepMeta {
  id: string;
  label: string;
  description?: string;
  optional?: boolean;
}

export const DEFAULT_PIPELINE_STEPS: PipelineStepMeta[] = [
  { id: 'pandoc', label: 'Pandoc 转换', description: 'Markdown → DOCX（HTML 管道）' },
  { id: 'vba', label: 'VBA 后处理', description: '标题归一、REF 域等' },
  { id: 'ooxml', label: 'OOXML 样式', description: '按 styles.yaml 注入' },
];
