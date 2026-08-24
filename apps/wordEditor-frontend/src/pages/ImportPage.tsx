import React, { useMemo } from 'react';
import { Button, Space, Tabs, Typography, Alert, Empty, Spin } from 'antd';
import {
  CloudDownloadOutlined,
  FileMarkdownOutlined,
  PictureOutlined,
  ExportOutlined,
  ConsoleSqlOutlined,
  FileZipOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import { LazyMarkdownEditor } from '@/components/code/LazyMarkdownEditor';
import { DocxUploader, ImageGallery } from '@/components/import';
import { useImportStore } from '@/store/importStore';
import { useExportStore } from '@/store/exportStore';

const { Text, Paragraph } = Typography;

/** DOCX → MD 还原页：上传 → 提取 → 预览/编辑 → 下载 / 转交导出页 */
export const ImportPage: React.FC = () => {
  const navigate = useNavigate();
  const busy = useImportStore((s) => s.busy);
  const result = useImportStore((s) => s.result);
  const markdown = useImportStore((s) => s.markdown);
  const setMarkdown = useImportStore((s) => s.setMarkdown);
  const lastError = useImportStore((s) => s.lastError);

  const setExportMarkdown = useExportStore((s) => s.setMarkdown);
  const setExportUpload = useExportStore((s) => s.setUpload);

  const images = useMemo(
    () =>
      (result?.entries ?? []).filter((e) =>
        /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(e.relPath),
      ),
    [result],
  );

  const handleDownloadMd = () => {
    if (!result) return;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    if (!result) return;
    const zip = new JSZip();
    // 入口 MD 用编辑器当前内容（用户可能改过），其它图片用还原后的 base64
    zip.file(result.mdRelPath, markdown);
    for (const ent of result.entries) {
      if (ent.relPath === result.mdRelPath) continue;
      zip.file(ent.relPath, ent.contentBase64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const zipName = result.fileName.replace(/\.md$/i, '') + '.zip';
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleSendToExport = () => {
    if (!result) return;
    // 把编辑后的 markdown 与图片一并送入导出 store，模拟“上传文件夹”路径
    const entries = result.entries.map((e) =>
      e.relPath === result.mdRelPath
        ? { relPath: e.relPath, contentBase64: btoa(unescape(encodeURIComponent(markdown))) }
        : { relPath: e.relPath, contentBase64: e.contentBase64 },
    );
    const totalBytes = result.entries.reduce((s, e) => s + e.size, 0);
    const sizeLabel =
      totalBytes > 1024 * 1024
        ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.round(totalBytes / 1024)} KB`;
    setExportMarkdown(markdown);
    setExportUpload(
      entries,
      result.mdRelPath,
      `${result.fileName} · ${entries.length} 个文件 · ${sizeLabel}（来自 DOCX 还原）`,
    );
    navigate('/export');
  };

  return (
    <div className="import-page">
      <div className="import-uploader-card">
        <DocxUploader />
      </div>

      {lastError && (
        <Alert
          type="error"
          showIcon
          message="还原失败"
          description={<Paragraph copyable>{lastError}</Paragraph>}
          style={{ marginTop: 16 }}
        />
      )}

      {busy && (
        <div className="import-busy">
          <Spin tip="正在解析 DOCX，提取段落 / 图片 / 公式…">
            <div style={{ minWidth: 240, minHeight: 48 }} />
          </Spin>
        </div>
      )}

      {result && !busy && (
        <div className="import-result">
          <header className="import-result-head">
            <Space size={12} wrap>
              <Text strong>{result.fileName}</Text>
              <Text type="secondary">
                {result.entries.length - 1} 张图片 · {markdown.length.toLocaleString()} 字
              </Text>
            </Space>
            <Space wrap>
              <Button icon={<CloudDownloadOutlined />} onClick={handleDownloadMd}>
                下载 .md
              </Button>
              <Button
                type="primary"
                icon={<FileZipOutlined />}
                onClick={() => void handleDownloadZip()}
              >
                下载 ZIP（MD + 图片）
              </Button>
              <Button icon={<ExportOutlined />} onClick={handleSendToExport}>
                送到导出页
              </Button>
            </Space>
          </header>

          <Tabs
            defaultActiveKey="md"
            items={[
              {
                key: 'md',
                label: (
                  <span>
                    <FileMarkdownOutlined /> Markdown ({markdown.length.toLocaleString()} 字)
                  </span>
                ),
                children: (
                  <div className="import-md-area">
                    <LazyMarkdownEditor
                      value={markdown}
                      onChange={setMarkdown}
                      path={result.fileName}
                    />
                  </div>
                ),
              },
              {
                key: 'images',
                label: (
                  <span>
                    <PictureOutlined /> 图片 ({images.length})
                  </span>
                ),
                children:
                  images.length === 0 ? (
                    <Empty description="原文档未包含图片" />
                  ) : (
                    <div className="import-images-area">
                      <ImageGallery entries={result.entries} />
                    </div>
                  ),
              },
              {
                key: 'log',
                label: (
                  <span>
                    <ConsoleSqlOutlined /> 日志
                  </span>
                ),
                children: (
                  <pre className="import-log">{result.log || '（无输出）'}</pre>
                ),
              },
            ]}
          />
        </div>
      )}

      {!result && !busy && !lastError && (
        <div className="import-hint">
          <Empty description="拖入 .docx 开始还原（保留段落 / 图片 / 公式，不丢内容）" />
        </div>
      )}
    </div>
  );
};
