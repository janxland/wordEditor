export interface ToolCheck {
  ok: boolean;
  path?: string | null;
  hint?: string | null;
}

export interface ToolsStatus {
  pandoc: ToolCheck;
  python: ToolCheck;
}

export async function fetchToolsStatus(baseUrl = '/api'): Promise<ToolsStatus> {
  const res = await fetch(`${baseUrl}/tools`);
  if (!res.ok) throw new Error(`tools check HTTP ${res.status}`);
  return res.json() as Promise<ToolsStatus>;
}
