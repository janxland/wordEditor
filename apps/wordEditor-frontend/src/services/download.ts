export async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`请求失败 (HTTP ${res.status})`);
  }
  return res.blob();
}

/** 触发浏览器下载 */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  const blob = await fetchAsBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
