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
  const autoDownload = useExportStore((s) => s.autoDownload);
  const setAutoDownload = useExportStore((s) => s.setAutoDownload);
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
    const all = Array.from(files);
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
    for (const f of all) {
      const buf = await f.arrayBuffer();
      entries.push({ relPath: relOf(f), contentBase64: arrayBufferToBase64(buf) });
    }

    const totalBytes = all.reduce((s, f) => s + f.size, 0);
    const sizeLabel =
      totalBytes > 1024 * 1024
        ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.round(totalBytes / 1024)} KB`;
    setUpload(entries, mdRel, `${md.name} · ${all.length} 个文件 · ${sizeLabel}`);
    void message.success(`已加载 ${md.name}，共 ${all.length} 个文件`);
    e.target.value = '';
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
                  下载
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
            <Tooltip title="选中 MD 所在文件夹；自动读取唯一/最顶层 .md 到编辑器，images/ 一并上传">
              <Button
                icon={<FolderOpenOutlined />}
                onClick={() => folderRef.current?.click()}
                block
              >
                选择文件夹
              </Button>
            </Tooltip>
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
                自动下载
              </Checkbox>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};
