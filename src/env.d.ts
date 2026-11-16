/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

/** Vite `?raw` 导入：以字符串形式读取源文件（测试用于解析 SFC <style> 规则） */
declare module '*?raw' {
  const src: string;
  export default src;
}

/**
 * Node 内置模块最小 ambient 声明（项目未安装 @types/node）。
 * 仅 tests/unit/responsive.spec.ts 经 node:fs 直读 responsive.css 源码
 * 用到一个函数（`.css?raw` 会被 Vitest 的 CSS 管线吞掉，返回空串）。
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}
