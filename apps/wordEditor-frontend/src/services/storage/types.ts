import type { TemplatesConfig } from '@/core/types';

export interface IStorageAdapter {
  readonly id: string;
  getTemplatesConfig(): Promise<TemplatesConfig>;
  readText(relativePath: string): Promise<string>;
  writeText(relativePath: string, content: string): Promise<void>;
  readDoc(name: string): Promise<string>;
}
