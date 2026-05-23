import React, { useEffect, useMemo } from 'react';
import { Button, Select, Space, Checkbox, Input, Tooltip } from 'antd';
import {
  ThunderboltOutlined,
  CloudDownloadOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
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
  const canExport = !disabled && pandocOk && !!markdown.trim();

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
