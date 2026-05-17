import type { IBuildPipeline } from './IBuildPipeline';
import type { BuildRequest, BuildResponse } from './types';

async function parseError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; detail?: string };
    return [j.error, j.detail].filter(Boolean).join('\n') || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export class HttpBuildPipeline implements IBuildPipeline {
  readonly id = 'http';

  constructor(private baseUrl = '/api') {}

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async build(request: BuildRequest): Promise<BuildResponse> {
    const res = await fetch(`${this.baseUrl}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const data = (await res.json()) as BuildResponse;
    if (!res.ok) {
      return {
        error: 'error' in data ? data.error : await parseError(res),
        detail: 'detail' in data ? data.detail : undefined,
        jobId: 'jobId' in data ? data.jobId : undefined,
      };
    }
    return data;
  }
}
