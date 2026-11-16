import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const HomePage = () => import('../pages/HomePage.vue');
const SubjectPage = () => import('../pages/SubjectPage.vue');
const PracticePage = () => import('../pages/PracticePage.vue');
const BoxPage = () => import('../pages/BoxPage.vue');
const IslandPage = () => import('../pages/IslandPage.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/subject/:id', name: 'subject', component: SubjectPage },
  { path: '/practice', name: 'practice', component: PracticePage },
  { path: '/box', name: 'box', component: BoxPage },
  { path: '/island', name: 'island', component: IslandPage },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
