import { create } from 'zustand';
import { getBuildPipeline, isBuildSuccess, type BuildOptions } from '@/kernel/pipeline';
import type { TemplatesConfig } from '@/core/types';

const SAMPLE_MD = `# 示例正文

一、绪论

本文演示 Markdown 一键导出 Word。

## 1.1 研究背景

行内公式 \\(E = mc^2\\) 与引用 [1]。

![示意图](/input/images/fig-emission.png)

图注由 Lua 自动加「图 N」前缀。

# 参考文献

<a id="Ref1"></a>[1] 示例文献. 期刊, 2024.
`;

interface ExportState {
  config: TemplatesConfig | null;
  markdown: string;
  templateId: string;
  fileName: string;
  options: BuildOptions;
  building: boolean;
  lastError: string | null;
  lastJobId: string | null;
  downloadUrl: string | null;

  init: (config: TemplatesConfig | null) => void;
  setMarkdown: (v: string) => void;
  setTemplateId: (id: string) => void;
  setFileName: (name: string) => void;
  setOptions: (patch: Partial<BuildOptions>) => void;
  loadSample: () => void;
  exportDocx: () => Promise<boolean>;
  resetResult: () => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  config: null,
  markdown: '',
  templateId: '',
  fileName: 'export.docx',
  options: {},
  building: false,
  lastError: null,
  lastJobId: null,
  downloadUrl: null,

  init: (config) => {
    const defaultId = config?.default_template ?? '';
    set((s) => ({
      config,
      templateId: s.templateId || defaultId,
      fileName: s.fileName || `export-${defaultId || 'out'}.docx`,
    }));
  },

  setMarkdown: (markdown) => set({ markdown }),
  setTemplateId: (templateId) =>
    set({ templateId, fileName: `export-${templateId}.docx` }),
  setFileName: (fileName) => set({ fileName }),
  setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
  loadSample: () => set({ markdown: SAMPLE_MD }),

  resetResult: () => set({ lastError: null, lastJobId: null, downloadUrl: null }),

  exportDocx: async () => {
    const { markdown, templateId, fileName, options } = get();
    if (!markdown.trim()) {
      set({ lastError: '请输入 Markdown 正文' });
      return false;
    }
    if (!templateId) {
      set({ lastError: '请选择模板' });
      return false;
    }

    set({ building: true, lastError: null, downloadUrl: null });
    try {
      const result = await getBuildPipeline().build({
        markdown,
        templateId,
        fileName,
        options,
      });
      if (!isBuildSuccess(result)) {
        set({
          building: false,
          lastError: [result.error, result.detail].filter(Boolean).join('\n'),
          lastJobId: result.jobId ?? null,
        });
        return false;
      }
      set({
        building: false,
        lastJobId: result.jobId,
        downloadUrl: result.downloadUrl,
      });
      return true;
    } catch (e) {
      set({
        building: false,
        lastError: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  },
}));
