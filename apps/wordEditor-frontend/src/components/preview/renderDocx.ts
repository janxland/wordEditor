/** 浏览器内渲染 docx（docx-preview） */
export async function renderDocxToElement(
  blob: Blob,
  bodyEl: HTMLElement,
  styleEl?: HTMLElement | null,
): Promise<void> {
  const { renderAsync } = await import('docx-preview');
  bodyEl.innerHTML = '';
  if (styleEl) styleEl.innerHTML = '';

  await renderAsync(blob, bodyEl, styleEl ?? undefined, {
    className: 'docx-preview-page',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
  });
}
