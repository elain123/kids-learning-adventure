import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import * as fc from 'fast-check';
import App from '@/App.vue';
import { router, routes } from '@/router';

describe('project scaffolding', () => {
  it('vitest executes and jsdom environment is available', () => {
    expect(typeof window).toBe('object');
    expect(1 + 1).toBe(2);
  });

  it('router skeleton exposes the 7 routes', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toEqual([
      '/',
      '/subject/:id',
      '/practice',
      '/box',
      '/island',
      '/island/wrong',
      '/parent-settings',
    ]);
  });

  it('App mounts with the router', async () => {
    await router.push('/');
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [router] } });
    expect(wrapper.exists()).toBe(true);
  });

  it('fast-check is wired in', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
      { numRuns: 100 }
    );
  });
});
