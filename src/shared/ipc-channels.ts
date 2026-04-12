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
  Document: {
    Read: 'document:read',
    Write: 'document:write',
    Changed: 'document:changed',
  },
  Documents: {
    List: 'documents:list',
    Create: 'documents:create',
    Delete: 'documents:delete',
  },
  Chat: {
    Send: 'chat:send',
    History: 'chat:history',
    Clear: 'chat:clear',
    Chunk: 'chat:chunk',
    ChunkDone: 'chat:chunk-done',
  },
  Sources: {
    Ingest: 'sources:ingest',
    List: 'sources:list',
    Read: 'sources:read',
    Delete: 'sources:delete',
    Changed: 'sources:changed',
  },
} as const;
