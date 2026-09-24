/** 路由共享的只读依赖：仓库根 + 任务缓存目录。 */
export interface AppContext {
  repoRoot: string;
  cacheDir: string;
}
