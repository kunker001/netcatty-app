const MAX_PLUGIN_VIEW_SCOPE_ID_LENGTH = 256;
const MAX_INLINE_ROUTE_LENGTH = MAX_PLUGIN_VIEW_SCOPE_ID_LENGTH - 'window:'.length;

function hashRoute(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function resolvePluginViewWindowScope(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
): string {
  const route = `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
  if (route.length <= MAX_INLINE_ROUTE_LENGTH && !route.includes('\0')) {
    return `window:${route}`;
  }
  return `window:route:${hashRoute(route)}`;
}

export function resolvePluginRetainedViewKey(viewId: string, scopeId: string): string {
  return JSON.stringify([viewId, scopeId]);
}

export function canRetainPluginViewInScope(viewScopeId: string, currentScopeId: string): boolean {
  return viewScopeId === currentScopeId;
}
