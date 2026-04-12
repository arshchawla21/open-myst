import type { MystApi } from '@shared/api';

const EXPECTED_NAMESPACES = ['settings', 'projects', 'document', 'documents', 'chat', 'sources'] as const;

function getApi(): MystApi {
  const api = window.myst as Partial<MystApi> | undefined;
  if (!api) {
    throw new Error(
      'Preload bridge not initialized (window.myst is undefined). ' +
        'The preload script did not run — check the main process logs.',
    );
  }
  for (const ns of EXPECTED_NAMESPACES) {
    if (!(ns in api)) {
      throw new Error(
        `Preload bridge is stale: missing "${ns}" namespace. ` +
          'Fully stop and restart `npm run dev` — Electron only loads the preload ' +
          'script once, so Vite HMR does not pick up changes to it.',
      );
    }
  }
  return api as MystApi;
}

export const bridge: MystApi = {
  get settings() {
    return getApi().settings;
  },
  get projects() {
    return getApi().projects;
  },
  get document() {
    return getApi().document;
  },
  get documents() {
    return getApi().documents;
  },
  get chat() {
    return getApi().chat;
  },
  get sources() {
    return getApi().sources;
  },
} as MystApi;
