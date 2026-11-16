import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // GitHub Pages 部署在 https://<user>.github.io/kids-learning-adventure/ 子路径下，
  // 资源必须以该前缀引用，否则线上白屏
  base: '/kids-learning-adventure/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
