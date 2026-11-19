import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const HomePage = () => import('../pages/HomePage.vue');
const SubjectPage = () => import('../pages/SubjectPage.vue');
const PracticePage = () => import('../pages/PracticePage.vue');
const BoxPage = () => import('../pages/BoxPage.vue');
const IslandPage = () => import('../pages/IslandPage.vue');
const WrongSetPage = () => import('../pages/WrongSetPage.vue');
const ParentSettingsPage = () => import('../pages/ParentSettingsPage.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/subject/:id', name: 'subject', component: SubjectPage },
  { path: '/practice', name: 'practice', component: PracticePage },
  { path: '/box', name: 'box', component: BoxPage },
  { path: '/island', name: 'island', component: IslandPage },
  // 错题集查看页（multi-grade-mistake-book 任务 12.1，Req 5.2-5.6）
  { path: '/island/wrong', name: 'wrong-set', component: WrongSetPage },
  // 家长设置页（child-grade-setting 任务 6.1，Req 1.2-1.9、3.5）：家长确认 → 孩子年级选择
  { path: '/parent-settings', name: 'parent-settings', component: ParentSettingsPage },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
