/** MD → Word 管线请求/响应（与 dev-api /build/stream 对齐） */

/** 产出留痕：写入 docx 文档属性 */
export interface BuildProvenance {
  /** 作者（dc:creator） */
  author?: string;
  /** 备注（dc:description） */
  remark?: string;
  /** 标题属性（dc:title）；缺省时可用输出文件名 */
  title?: string;
}

export const DEFAULT_BUILD_PROVENANCE: BuildProvenance = {
  author: 'janxland',
  remark: '+wx:janxland',
};

export interface BuildOptions {
  noHtmlPipe?: boolean;
  noPostprocess?: boolean;
  /** Word「修改密码」（writeProtection），空值/未设则不加锁 */
  password?: string;
  /** 页眉文案；支持 {page} / {pages} 或 N / M 动态域，空字符串表示清空 */
  headerText?: string;
  headerAlign?: 'left' | 'center' | 'right';
  headerVerticalAlign?: 'top' | 'center' | 'bottom';
  /** 页脚文案；支持 {page} / {pages} 或 N / M 动态域，空字符串表示清空 */
  footerText?: string;
  footerAlign?: 'left' | 'center' | 'right';
  footerVerticalAlign?: 'top' | 'center' | 'bottom';
}

export const DEFAULT_FOOTER_TEXT = '第 {page} 页 / 共 {pages} 页';

export interface BuildUploadEntry {
  /** 相对路径（POSIX 风格），例: 'images/fig1.png' 或 'paper.md' */
  relPath: string;
  /** 文件二进制 base64 */
  contentBase64: string;
}

export interface BuildRequest {
  /** Markdown 文本内容（与 entries 二选一） */
  markdown?: string;
  /** 上传多文件（MD + 图片），保留相对路径以便 images/ 就地解析 */
  entries?: BuildUploadEntry[];
  /** 上传中作为入口 .md 的相对路径，与 entries 配套 */
  mdRelPath?: string;
  templateId: string;
  fileName?: string;
  options?: BuildOptions;
  /** 产出留痕（默认作者 janxland、备注 +wx:janxland） */
  provenance?: BuildProvenance;
}

export interface BuildSuccess {
  jobId: string;
  fileName: string;
  downloadUrl: string;
}

export interface PipelineStepMeta {
  id: string;
  label: string;
  description?: string;
}
