import { HttpStorageAdapter } from './httpStorage';
import type { IStorageAdapter } from './types';

let instance: IStorageAdapter | null = null;

export function getStorage(): IStorageAdapter {
  if (!instance) {
    instance = new HttpStorageAdapter();
  }
  return instance;
}

export function setStorage(adapter: IStorageAdapter): void {
  instance = adapter;
}

export type { IStorageAdapter } from './types';
