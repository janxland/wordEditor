import { create } from 'zustand';
import { notification } from 'antd';
import type { BuildOptions, BuildUploadEntry, BuildProvenance } from '@/kernel/pipeline';
import { DEFAULT_BUILD_PROVENANCE, DEFAULT_FOOTER_TEXT } from '@/kernel/pipeline';
import { streamBuild } from '@/kernel/pipeline/streamBuild';
import type { BuildStreamStepEvent } from '@/kernel/pipeline/streamBuild';
import {
  createInitialBuildSteps,
  type BuildStepState,
} from '@/kernel/pipeline/buildSteps';
import { downloadBlob, fetchAsBlob } from '@/services/download';
import { saveBlobToWorkspaceFolder } from '@/services/localFolder';
import type { TemplatesConfig } from '@/core/types';

const SAMPLE_MD = `<!-- 导出页示例：完整稿见 input/carbon-neutral-renewable.md -->

摘要

双碳背景下风光储协同优化示例摘要，含行内公式 \\(c_{CO_2}\\) 与引用[1]。

**关键词**：双碳目标；新能源消纳；储能优化

Abstract

Sample abstract with \\(c_{CO_2}\\) and citation[2].

**Keywords**: dual-carbon; renewable integration; energy storage

一、绪论

1.1 模型说明

$$
SOC(t+1) = SOC(t) + \\frac{\\eta_c P_{ch}(t) - P_{dis}(t)/\\eta_d}{E_{cap}} \\Delta t
$$

![碳排放对比](images/fig-emission.png)

参考文献

<a id="Ref1"></a>[1] 中共中央, 国务院. 碳达峰碳中和工作的意见[Z]. 2021.

<a id="Ref2"></a>[2] 国家能源局. 新型电力系统发展蓝皮书[R]. 2023.
`;

const MAX_LOG_LINES = 120;

function patchStep(steps: BuildStepState[], event: BuildStreamStepEvent): BuildStepState[] {
  const i = steps.findIndex((s) => s.id === event.id);
  if (i < 0) return steps;
  const next = steps.map((s) => ({ ...s }));
  next[i] = {
    ...next[i],
    status: event.status,
    message: event.message ?? next[i].message,
  };
  return next;
}

function appendLog(logs: string[], line: string, stream: 'stdout' | 'stderr'): string[] {
  if (!line.trim()) return logs;
  const prefix = stream === 'stderr' ? '⚠ ' : '';
  const next = [...logs, `${prefix}${line}`];
  return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
}

interface ExportState {
  config: TemplatesConfig | null;
  markdown: string;
  /** 文件夹上传状态（含 MD 与 images/） */
  uploadEntries: BuildUploadEntry[];
  uploadMdRelPath: string;
  uploadLabel: string;
  templateId: string;
  fileName: string;
  options: BuildOptions;
  provenance: BuildProvenance;
  building: boolean;
  lastError: string | null;
  downloadUrl: string | null;

  progressOpen: boolean;
  resultOpen: boolean;
  errorModalOpen: boolean;
  buildSteps: BuildStepState[];
  buildLogs: string[];
  buildStartedAt: number | null;
  buildFinishedAt: number | null;
  statusMessage: string;
  downloading: boolean;
  autoDownload: boolean;
  /** 导出后直接写入所选工作区文件夹，不经过浏览器下载目录 */
  saveToWorkspaceFolder: boolean;
  workspaceDirHandle: FileSystemDirectoryHandle | null;
  workspaceDirName: string;
  abortController: AbortController | null;

  init: (config: TemplatesConfig | null) => void;
  setMarkdown: (v: string) => void;
  setUpload: (entries: BuildUploadEntry[], mdRelPath: string, label: string) => void;
  clearUpload: () => void;
  setTemplateId: (id: string) => void;
  setFileName: (name: string) => void;
  setOptions: (patch: Partial<BuildOptions>) => void;
  setProvenance: (patch: Partial<BuildProvenance>) => void;
  setAutoDownload: (v: boolean) => void;
  setSaveToWorkspaceFolder: (v: boolean) => void;
  setWorkspaceFolder: (handle: FileSystemDirectoryHandle | null, name?: string) => void;
  loadSample: () => void;
  exportDocx: () => Promise<boolean>;
  cancelBuild: () => void;
  downloadDocx: (silent?: boolean) => Promise<void>;
  closeResult: () => void;
  closeErrorModal: () => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  config: null,
  markdown: '',
  uploadEntries: [],
  uploadMdRelPath: '',
  uploadLabel: '',
  templateId: '',
  fileName: 'export.docx',
  options: {},
  provenance: { ...DEFAULT_BUILD_PROVENANCE },
  building: false,
  lastError: null,
  downloadUrl: null,

  progressOpen: false,
  resultOpen: false,
  errorModalOpen: false,
  buildSteps: [],
  buildLogs: [],
  buildStartedAt: null,
  buildFinishedAt: null,
  statusMessage: '',
  downloading: false,
  autoDownload: true,
  saveToWorkspaceFolder: false,
  workspaceDirHandle: null,
  workspaceDirName: '',
  abortController: null,

  init: (config) => {
    const defaultId = config?.default_template ?? '';
    set((s) => ({
      config,
      templateId: s.templateId || defaultId,
      fileName: s.fileName || `export-${defaultId || 'out'}.docx`,
    }));
  },

  setMarkdown: (markdown) => set({ markdown }),
  setUpload: (uploadEntries, uploadMdRelPath, uploadLabel) => {
    const base = uploadMdRelPath.split(/[\\/]/).pop() ?? 'export';
    const stem = base.replace(/\.md$/i, '');
    const tid = get().templateId || 'out';
    set({ uploadEntries, uploadMdRelPath, uploadLabel, fileName: `${stem}-${tid}.docx` });
  },
  clearUpload: () =>
    set({
      uploadEntries: [],
      uploadMdRelPath: '',
      uploadLabel: '',
      workspaceDirHandle: null,
      workspaceDirName: '',
      saveToWorkspaceFolder: false,
    }),
  setTemplateId: (templateId) =>
    set({ templateId, fileName: `export-${templateId}.docx` }),
  setFileName: (fileName) => set({ fileName }),
  setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
  setProvenance: (patch) => set((s) => ({ provenance: { ...s.provenance, ...patch } })),
  setAutoDownload: (autoDownload) => set({ autoDownload }),
  setSaveToWorkspaceFolder: (saveToWorkspaceFolder) => set({ saveToWorkspaceFolder }),
  setWorkspaceFolder: (workspaceDirHandle, name) =>
    set({
      workspaceDirHandle,
      workspaceDirName: name ?? workspaceDirHandle?.name ?? '',
      saveToWorkspaceFolder: workspaceDirHandle ? get().saveToWorkspaceFolder : false,
    }),
  loadSample: () => set({ markdown: SAMPLE_MD }),

  closeErrorModal: () => set({ errorModalOpen: false, lastError: null }),
  closeResult: () => set({ resultOpen: false }),

  cancelBuild: () => {
    get().abortController?.abort();
    set({
      building: false,
      progressOpen: false,
      abortController: null,
      statusMessage: '已取消',
    });
    notification.info({ message: '已取消导出', placement: 'bottomRight', duration: 3 });
  },

  downloadDocx: async (silent = false) => {
    const { downloadUrl, fileName, saveToWorkspaceFolder, workspaceDirHandle, workspaceDirName } =
      get();
    if (!downloadUrl) return;
    set({ downloading: true });
    try {
      const blob = await fetchAsBlob(downloadUrl);
      if (saveToWorkspaceFolder && workspaceDirHandle) {
        await saveBlobToWorkspaceFolder(workspaceDirHandle, fileName, blob);
        if (!silent) {
          notification.success({
            message: '已保存到工作区文件夹',
            description: `${workspaceDirName}/${fileName}`,
            placement: 'bottomRight',
            duration: 3,
          });
        }
      } else {
        await downloadBlob(blob, fileName);
        if (!silent) {
          notification.success({
            message: '下载已开始',
            description: fileName,
            placement: 'bottomRight',
            duration: 3,
          });
        }
      }
    } catch (e) {
      notification.error({
        message: saveToWorkspaceFolder ? '保存失败' : '下载失败',
        description: e instanceof Error ? e.message : String(e),
        placement: 'bottomRight',
      });
    } finally {
      set({ downloading: false });
    }
  },

  exportDocx: async () => {
    const {
      markdown,
      uploadEntries,
      uploadMdRelPath,
      templateId,
      fileName,
      options,
      provenance,
      autoDownload,
    } = get();
    const useUpload = uploadEntries.length > 0 && !!uploadMdRelPath;
    if (!useUpload && !markdown.trim()) {
      notification.warning({
        message: '请选择文件夹或输入 Markdown',
        placement: 'bottomRight',
      });
      return false;
    }
    if (!templateId) {
      notification.warning({ message: '请选择模板', placement: 'bottomRight' });
      return false;
    }

    const exportOptions: BuildOptions = {
      ...options,
      footerText: options.footerText ?? DEFAULT_FOOTER_TEXT,
      headerAlign: options.headerAlign ?? 'center',
      headerVerticalAlign: options.headerVerticalAlign ?? 'center',
      footerAlign: options.footerAlign ?? 'center',
      footerVerticalAlign: options.footerVerticalAlign ?? 'center',
    };
    const ac = new AbortController();
    const startedAt = Date.now();
    const initialSteps = createInitialBuildSteps(exportOptions);
    initialSteps[0] = { ...initialSteps[0], status: 'process', message: '校验环境…' };

    set({
      building: true,
      progressOpen: true,
      resultOpen: false,
      errorModalOpen: false,
      lastError: null,
      downloadUrl: null,
      buildSteps: initialSteps,
      buildLogs: [],
      buildStartedAt: startedAt,
      buildFinishedAt: null,
      statusMessage: '正在连接构建服务…',
      abortController: ac,
    });

    try {
      const result = await streamBuild(
        '/api',
        {
          markdown: useUpload ? undefined : markdown,
          entries: useUpload ? uploadEntries : undefined,
          mdRelPath: useUpload ? uploadMdRelPath : undefined,
          templateId,
          fileName,
          options: exportOptions,
          provenance: {
            author: provenance.author?.trim() || DEFAULT_BUILD_PROVENANCE.author,
            remark: provenance.remark?.trim() || DEFAULT_BUILD_PROVENANCE.remark,
            title:
              provenance.title?.trim() ||
              fileName.replace(/\.docx$/i, '') ||
              undefined,
          },
        },
        {
          signal: ac.signal,
          onStep: (event) => {
            set((s) => ({
              buildSteps: patchStep(s.buildSteps, event),
              statusMessage: event.message ?? s.statusMessage,
            }));
          },
          onLog: (line, stream) => {
            set((s) => ({ buildLogs: appendLog(s.buildLogs, line, stream) }));
          },
        },
      );

      const finalSteps: BuildStepState[] = get().buildSteps.map((s) => ({
        ...s,
        status: s.status === 'error' ? ('error' as const) : ('finish' as const),
      }));

      set({
        building: false,
        progressOpen: false,
        resultOpen: true,
        downloadUrl: result.downloadUrl,
        fileName: result.fileName || fileName,
        buildSteps: finalSteps,
        buildFinishedAt: Date.now(),
        statusMessage: '构建完成',
        abortController: null,
      });

      if (autoDownload) {
        await get().downloadDocx(true);
      }

      return true;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return false;
      }
      const detail = (e as Error & { detail?: string }).detail;
      const msg = e instanceof Error ? e.message : String(e);

      set((s) => ({
        building: false,
        progressOpen: false,
        errorModalOpen: true,
        lastError: [msg, detail].filter(Boolean).join('\n'),
        buildSteps: s.buildSteps.map((step) =>
          step.status === 'process' ? { ...step, status: 'error' as const } : step,
        ),
        buildFinishedAt: Date.now(),
        abortController: null,
      }));

      notification.error({
        message: '导出失败',
        description: msg.length > 120 ? `${msg.slice(0, 120)}…` : msg,
        placement: 'bottomRight',
        duration: 5,
      });

      return false;
    }
  },
}));
