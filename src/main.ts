import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
// 全局响应式基础样式：盒模型、横向滚动防护、安全区、断点与横竖屏自适应
// （Req 11.2-11.5, 12.2）
import './styles/responsive.css';

createApp(App).use(router).mount('#app');
