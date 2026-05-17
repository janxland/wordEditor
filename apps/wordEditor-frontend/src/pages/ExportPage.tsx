import React, { useEffect } from 'react';
import {
  Button,
  Select,
  Space,
  Typography,
  Alert,
  Checkbox,
  Input,
  Steps,
  Card,
  Tooltip,
} from 'antd';
import {
  DownloadOutlined,
  FileWordOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { LazyCodeEditor } from '@/components/code/LazyCodeEditor';
import { DEFAULT_PIPELINE_STEPS, fetchToolsStatus, type ToolsStatus } from '@/kernel/pipeline';
import { useAppStore } from '@/store/appStore';
import { useExportStore } from '@/store/exportStore';

const { Text, Title } = Typography;

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
  const building = useExportStore((s) => s.building);
  const lastError = useExportStore((s) => s.lastError);
  const downloadUrl = useExportStore((s) => s.downloadUrl);
  const exportDocx = useExportStore((s) => s.exportDocx);
  const loadSample = useExportStore((s) => s.loadSample);
  const resetResult = useExportStore((s) => s.resetResult);

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

  const currentStep = building ? 1 : downloadUrl ? 2 : 0;
  const disabled = apiReady === false;
  const pandocOk = tools?.pandoc.ok ?? true;

  return (
    <div className="export-page">
      <div className="export-header">
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <FileWordOutlined /> Markdown → Word
          </Title>
          <Text type="secondary">
            输入正文 MD，选择模板，一键走 Pandoc + VBA + OOXML 管线
          </Text>
        </div>
        <Space>
          <Button onClick={loadSample} disabled={disabled}>
            加载示例
          </Button>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            loading={building}
            disabled={disabled || !pandocOk || !markdown.trim()}
            onClick={() => void exportDocx()}
          >
            导出 Word
          </Button>
        </Space>
      </div>

      {disabled && (
        <Alert
          type="warning"
          showIcon
          message="构建 API 不可用"
          description="请使用 pnpm dev 启动前端，并确保本机已安装 Python、Pandoc 与 Word（VBA 后处理）。"
          style={{ marginBottom: 12 }}
        />
      )}

      {!disabled && tools && !tools.pandoc.ok && (
        <Alert
          type="error"
          showIcon
          message="未检测到 Pandoc"
          description={
            <>
              <div>请安装后重启终端与 dev 服务：</div>
              <code>winget install --id JohnMacFarlane.Pandoc</code>
              <div style={{ marginTop: 8 }}>
                已安装但仍报错时，将 WinGet 目录加入 PATH，或设置环境变量{' '}
                <code>PANDOC</code> 为 pandoc.exe 完整路径。
              </div>
            </>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      {!disabled && tools?.pandoc.ok && tools.pandoc.path && (
        <Alert
          type="info"
          showIcon
          message="Pandoc 已就绪"
          description={<code style={{ fontSize: 12 }}>{tools.pandoc.path}</code>}
          style={{ marginBottom: 12 }}
          closable
        />
      )}

      {lastError && (
        <Alert
          type="error"
          showIcon
          closable
          message="导出失败"
          description={<pre className="export-error">{lastError}</pre>}
          style={{ marginBottom: 12 }}
          onClose={resetResult}
        />
      )}

      {downloadUrl && (
        <Alert
          type="success"
          showIcon
          message="导出成功"
          description={
            <Button
              type="link"
              icon={<DownloadOutlined />}
              href={downloadUrl}
              download={fileName}
            >
              下载 {fileName}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      <div className="export-body">
        <section className="export-editor">
          <LazyCodeEditor
            language="markdown"
            path="export-input.md"
            value={markdown}
            onChange={setMarkdown}
            height="calc(100vh - 280px)"
          />
        </section>

        <aside className="export-sidebar">
          <Card size="small" title="模板" className="export-card">
            <Select
              style={{ width: '100%' }}
              value={templateId || undefined}
              placeholder="选择模板"
              options={(config?.templates ?? []).map((t) => ({
                value: t.id,
                label: t.name,
              }))}
              onChange={setTemplateId}
            />
            <Input
              style={{ marginTop: 10 }}
              addonBefore="文件名"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </Card>

          <Card size="small" title="管线选项" className="export-card">
            <Space direction="vertical">
              <Checkbox
                checked={!options.noHtmlPipe}
                onChange={(e) => setOptions({ noHtmlPipe: !e.target.checked })}
              >
                HTML 管道（推荐，支持公式/书签）
              </Checkbox>
              <Checkbox
                checked={!options.noPostprocess}
                onChange={(e) => setOptions({ noPostprocess: !e.target.checked })}
              >
                VBA + OOXML 后处理
              </Checkbox>
              <Tooltip title="公式已由 Pandoc 转 OMML 时通常无需再跑">
                <Checkbox
                  checked={!!options.withFormulaMacro}
                  disabled={!!options.noPostprocess}
                  onChange={(e) => setOptions({ withFormulaMacro: e.target.checked })}
                >
                  VBA 公式宏
                </Checkbox>
              </Tooltip>
              <Checkbox
                checked={!!options.renderMath}
                onChange={(e) => setOptions({ renderMath: e.target.checked })}
              >
                预渲染 LaTeX 为 Unicode
              </Checkbox>
            </Space>
          </Card>

          <Card size="small" title="管线步骤" className="export-card">
            <Steps
              direction="vertical"
              size="small"
              current={currentStep}
              items={DEFAULT_PIPELINE_STEPS.map((s) => ({
                title: s.label,
                description: s.description,
              }))}
            />
          </Card>

          <Text type="secondary" style={{ fontSize: 12 }}>
            图片路径相对于仓库根目录（如 input/images/…）。自定义模板需已放置
            reference.docx。
          </Text>
        </aside>
      </div>
    </div>
  );
};
