import React, { useEffect, useMemo, useRef } from 'react';
import { Button, Select, Space, Checkbox, Input, Tooltip, message } from 'antd';
import {
  ThunderboltOutlined,
  CloudDownloadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import type { BuildUploadEntry } from '@/kernel/pipeline';
import { LazyMarkdownEditor } from '@/components/code/LazyMarkdownEditor';
import {
  BuildProgressModal,
  ExportResultModal,
  ExportErrorModal,
} from '@/components/feedback';
import { fetchToolsStatus, type ToolsStatus } from '@/kernel/pipeline';
import { isFileSystemAccessSupported, loadWorkspaceFolder } from '@/services/localFolder';
import { useAppStore } from '@/store/appStore';
import { useExportStore } from '@/store/exportStore';

export const ExportPage: React.FC = () => {
  const config = useAppStore((s) => s.config);
  const apiReady = useAppStore((s) => s.apiReady);

  const init = useExportStore((s) => s.init);
  const markdown = useExportStore((s) => s.markdown);
  const setMarkdown = useExportStore((s) => s.setMarkdown);
  const uploadEntries = useExportStore((s) => s.uploadEntries);
  const uploadMdRelPath = useExportStore((s) => s.uploadMdRelPath);
  const uploadLabel = useExportStore((s) => s.uploadLabel);
  const setUpload = useExportStore((s) => s.setUpload);
  const clearUpload = useExportStore((s) => s.clearUpload);
  const templateId = useExportStore((s) => s.templateId);
  const setTemplateId = useExportStore((s) => s.setTemplateId);
  const fileName = useExportStore((s) => s.fileName);
  const setFileName = useExportStore((s) => s.setFileName);
  const options = useExportStore((s) => s.options);
  const setOptions = useExportStore((s) => s.setOptions);
  const provenance = useExportStore((s) => s.provenance);
  const setProvenance = useExportStore((s) => s.setProvenance);
  const autoDownload = useExportStore((s) => s.autoDownload);
  const setAutoDownload = useExportStore((s) => s.setAutoDownload);
  const saveToWorkspaceFolder = useExportStore((s) => s.saveToWorkspaceFolder);
  const setSaveToWorkspaceFolder = useExportStore((s) => s.setSaveToWorkspaceFolder);
  const workspaceDirHandle = useExportStore((s) => s.workspaceDirHandle);
  const workspaceDirName = useExportStore((s) => s.workspaceDirName);
  const setWorkspaceFolder = useExportStore((s) => s.setWorkspaceFolder);
  const building = useExportStore((s) => s.building);
  const lastError = useExportStore((s) => s.lastError);
  const downloadUrl = useExportStore((s) => s.downloadUrl);
  const exportDocx = useExportStore((s) => s.exportDocx);
  const loadSample = useExportStore((s) => s.loadSample);
  const errorModalOpen = useExportStore((s) => s.errorModalOpen);
  const closeErrorModal = useExportStore((s) => s.closeErrorModal);
  const cancelBuild = useExportStore((s) => s.cancelBuild);
  const downloadDocx = useExportStore((s) => s.downloadDocx);
  const downloading = useExportStore((s) => s.downloading);

  const progressOpen = useExportStore((s) => s.progressOpen);
  const resultOpen = useExportStore((s) => s.resultOpen);
  const buildSteps = useExportStore((s) => s.buildSteps);
  const buildLogs = useExportStore((s) => s.buildLogs);
  const buildStartedAt = useExportStore((s) => s.buildStartedAt);
  const buildFinishedAt = useExportStore((s) => s.buildFinishedAt);
  const statusMessage = useExportStore((s) => s.statusMessage);
  const closeResult = useExportStore((s) => s.closeResult);

  const [tools, setTools] = React.useState<ToolsStatus | null>(null);

  useEffect(() => {
    init(config);
  }, [config, init]);

  useEffect(() => {
    if (apiReady === false) return;
    void fetchToolsStatus()
      .then(setTools)
      .catch(() => setTools(null));
  }, [apiReady]);

  const disabled = apiReady === false;
  const pandocOk = tools?.pandoc.ok ?? true;
  const hasUpload = uploadEntries.length > 0 && !!uploadMdRelPath;
  const canExport = !disabled && pandocOk && (hasUpload || !!markdown.trim());

  const folderRef = useRef<HTMLInputElement>(null);
  const fsAccessSupported = isFileSystemAccessSupported();

  const arrayBufferToBase64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
    }
    return btoa(bin);
  };

  const relOf = (f: File) =>
    ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(
      /\\/g,
      '/',
    );

  const handleFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setWorkspaceFolder(null);
    const all = Array.from(files);
    // 只保留 .md 和常见图片格式，跳过 PPTX/DOCX/PDF 等大型二进制文件
    const ALLOWED_EXT = /\.(md|png|jpg|jpeg|gif|webp|svg|bmp|tiff?)$/i;
    const filtered = all.filter((f) => ALLOWED_EXT.test(relOf(f)));
    const mdFiles = all.filter((f) => /\.md$/i.test(relOf(f)));
    if (mdFiles.length === 0) {
      void message.error('文件夹中未找到 .md');
      e.target.value = '';
      return;
    }
    // 选最顶层的 .md（路径最短）
    const md = mdFiles.slice().sort((a, b) => relOf(a).length - relOf(b).length)[0];
    const mdRel = relOf(md);

    // 自动读取 MD 文本到左侧编辑器
    const mdText = await md.text();
    setMarkdown(mdText);

    // 串行读取全部文件为 base64、保留相对路径
    const entries: BuildUploadEntry[] = [];
    const skipped = all.length - filtered.length;
    for (const f of filtered) {
      const buf = await f.arrayBuffer();
      entries.push({ relPath: relOf(f), contentBase64: arrayBufferToBase64(buf) });
    }

    const totalBytes = filtered.reduce((s, f) => s + f.size, 0);
    const sizeLabel =
      totalBytes > 1024 * 1024
        ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.round(totalBytes / 1024)} KB`;
    setUpload(entries, mdRel, `${md.name} · ${all.length} 个文件 · ${sizeLabel}`);
    const skippedTip = skipped > 0 ? `，已跳过 ${skipped} 个非图文文件` : '';
    void message.success(`已加载 ${md.name}，共 ${filtered.length} 个文件${skippedTip}`);
    e.target.value = '';
  };

  const pickFolder = async () => {
    if (fsAccessSupported) {
      try {
        const handle = await window.showDirectoryPicker!({ mode: 'readwrite' });
        const loaded = await loadWorkspaceFolder(handle);
        setMarkdown(loaded.mdText);
        setUpload(loaded.entries, loaded.mdRelPath, loaded.label);
        setWorkspaceFolder(loaded.handle, handle.name);
        const skippedTip = loaded.skipped > 0 ? `，已跳过 ${loaded.skipped} 个非图文文件` : '';
        void message.success(
          `已加载 ${handle.name}，共 ${loaded.entries.length} 个文件${skippedTip}`,
        );
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        void message.error(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    folderRef.current?.click();
  };

  const templateName = useMemo(
    () => config?.templates.find((t) => t.id === templateId)?.name,
    [config, templateId],
  );

  const elapsedMs =
    buildStartedAt && buildFinishedAt ? buildFinishedAt - buildStartedAt : undefined;

  const handleExport = () => {
    closeErrorModal();
    void exportDocx();
  };

  const banner = disabled
    ? '构建 API 未连接 · 请 pnpm dev 启动'
    : tools && !tools.pandoc.ok
      ? '未检测到 Pandoc'
      : null;

  return (
    <div className="export-page">
      <BuildProgressModal
        open={progressOpen}
        steps={buildSteps}
        logs={buildLogs}
        startedAt={buildStartedAt}
        statusMessage={statusMessage}
        onCancel={cancelBuild}
      />

      <ExportResultModal
        open={resultOpen}
        fileName={fileName}
        templateName={templateName}
        elapsedMs={elapsedMs}
        downloading={downloading}
        saveToWorkspaceFolder={saveToWorkspaceFolder}
        workspaceDirName={workspaceDirName}
        onDownload={() => void downloadDocx()}
        onExportAgain={() => {
          closeResult();
          handleExport();
        }}
        onClose={closeResult}
      />

      <ExportErrorModal
        open={errorModalOpen && !!lastError}
        error={lastError ?? ''}
        logs={buildLogs}
        onRetry={handleExport}
        onClose={closeErrorModal}
      />

      <div className="export-layout">
        <main className="export-main">
          <header className="export-main-head">
            <div className="export-main-head-left">
              <FileTextOutlined className="export-main-icon" />
              <span>文稿</span>
              {banner && <span className="export-banner">{banner}</span>}
            </div>
            <Space size={8} wrap className="export-main-actions">
              <Button type="text" size="small" onClick={loadSample} disabled={disabled}>
                示例
              </Button>
              {downloadUrl && !building && (
                <Button
                  type="text"
                  size="small"
                  icon={<CloudDownloadOutlined />}
                  onClick={() => void downloadDocx()}
                >
                  {saveToWorkspaceFolder && workspaceDirHandle ? '保存' : '下载'}
                </Button>
              )}
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={building}
                disabled={!canExport}
                onClick={handleExport}
              >
                导出 Word
              </Button>
            </Space>
          </header>

          <LazyMarkdownEditor
            value={markdown}
            onChange={setMarkdown}
            path={fileName.replace(/\.docx$/i, '.md') || 'document.md'}
          />
        </main>

        <aside className="export-rail">
          <section className="export-rail-block">
            <label className="export-rail-label">模板</label>
            <Select
              size="middle"
              style={{ width: '100%' }}
              value={templateId || undefined}
              placeholder="选择"
              options={(config?.templates ?? []).map((t) => ({
                value: t.id,
                label: t.name,
              }))}
              onChange={setTemplateId}
            />
            <Input
              size="middle"
              style={{ marginTop: 8 }}
              placeholder="输出文件名.docx"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </section>

          <section className="export-rail-block">
            <label className="export-rail-label">
              选择本地稿件 <span style={{ color: '#999', fontWeight: 'normal' }}>（可选）</span>
            </label>
            <input
              ref={folderRef}
              type="file"
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-expect-error webkitdirectory 非标准但 Chromium/Edge/Firefox 均支持
              webkitdirectory=""
              directory=""
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void handleFolder(e)}
            />
            <Tooltip
              title={
                fsAccessSupported
                  ? '选中 MD 所在文件夹；自动读取唯一/最顶层 .md 到编辑器，images/ 一并上传'
                  : '当前浏览器不支持直接写入文件夹，将使用传统文件夹选择（仅读取）'
              }
            >
              <Button icon={<FolderOpenOutlined />} onClick={() => void pickFolder()} block>
                选择文件夹
              </Button>
            </Tooltip>
            {workspaceDirName && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
                工作区：{workspaceDirName}
              </div>
            )}
            {hasUpload && (
              <div
                style={{
                  marginTop: 8,
                  padding: '6px 8px',
                  background: '#f5f5f5',
                  borderRadius: 4,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={uploadLabel}
                >
                  {uploadLabel}
                </span>
                <Tooltip title="清除上传">
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseCircleOutlined />}
                    onClick={clearUpload}
                  />
                </Tooltip>
              </div>
            )}
          </section>

          <section className="export-rail-block">
            <label className="export-rail-label">产出留痕</label>
            <Tooltip title="写入 Word 文档属性：文件 → 信息 → 属性">
              <Input
                size="middle"
                style={{ marginBottom: 8 }}
                placeholder="作者"
                value={provenance.author ?? ''}
                onChange={(e) => setProvenance({ author: e.target.value })}
                allowClear
              />
            </Tooltip>
            <Input
              size="middle"
              style={{ marginBottom: 8 }}
              placeholder="备注"
              value={provenance.remark ?? ''}
              onChange={(e) => setProvenance({ remark: e.target.value })}
              allowClear
            />
            <Input
              size="middle"
              placeholder="标题属性（默认取输出文件名）"
              value={provenance.title ?? ''}
              onChange={(e) => setProvenance({ title: e.target.value })}
              allowClear
            />
          </section>

          <section className="export-rail-block">
            <label className="export-rail-label">
              修改密码 <span style={{ color: '#999', fontWeight: 'normal' }}>（可选）</span>
            </label>
            <Tooltip title="未输入密码者只能以「只读」方式打开；不加密文件内容。留空则不加锁。">
              <Input.Password
                size="middle"
                placeholder="留空 = 不加锁"
                value={options.password ?? ''}
                onChange={(e) => setOptions({ password: e.target.value })}
                autoComplete="new-password"
                allowClear
              />
            </Tooltip>
          </section>

          <section className="export-rail-block">
            <label className="export-rail-label">管线</label>
            <div className="export-rail-checks">
              <Tooltip title="TeX 公式（$...$、$$...$$、\\(...\\)）由 Pandoc 转为 Word OMML">
                <Checkbox
                  checked={!options.noHtmlPipe}
                  onChange={(e) => setOptions({ noHtmlPipe: !e.target.checked })}
                >
                  HTML 管道
                </Checkbox>
              </Tooltip>
              <Checkbox
                checked={!options.noPostprocess}
                onChange={(e) => setOptions({ noPostprocess: !e.target.checked })}
              >
                结构 + 样式
              </Checkbox>
              <Checkbox checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)}>
                {saveToWorkspaceFolder && workspaceDirHandle ? '自动保存' : '自动下载'}
              </Checkbox>
              <Tooltip
                title={
                  workspaceDirHandle
                    ? '导出完成后直接写入所选工作区文件夹，不经过浏览器下载目录'
                    : '请先通过「选择文件夹」选定可写入的工作区（需 Chrome / Edge）'
                }
              >
                <Checkbox
                  checked={saveToWorkspaceFolder}
                  disabled={!workspaceDirHandle}
                  onChange={(e) => setSaveToWorkspaceFolder(e.target.checked)}
                >
                  保存到工作区文件夹
                </Checkbox>
              </Tooltip>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};
