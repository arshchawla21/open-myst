export const IpcChannels = {
  Settings: {
    Get: 'settings:get',
    SetOpenRouterKey: 'settings:set-openrouter-key',
    HasOpenRouterKey: 'settings:has-openrouter-key',
    ClearOpenRouterKey: 'settings:clear-openrouter-key',
    SetDefaultModel: 'settings:set-default-model',
  },
  Projects: {
    CreateNew: 'projects:create-new',
    Open: 'projects:open',
    GetCurrent: 'projects:get-current',
    Close: 'projects:close',
    ListRecent: 'projects:list-recent',
  },
} as const;
