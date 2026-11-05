import { pathToFileURL } from 'node:url';

export const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
// Chromium ignores frame-ancestors in a meta element; the response policy keeps it.
export const META_CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY.replace("; frame-ancestors 'none'", '');

export function isApplicationNavigation(value, entryPath) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === pathToFileURL(entryPath).href;
  } catch { return false; }
}

export function secureSession(session) {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: {...details.responseHeaders, 'Content-Security-Policy': [CONTENT_SECURITY_POLICY]}
  }));
}

export function secureWindow(contents, entryPath) {
  contents.setWindowOpenHandler(() => ({action: 'deny'}));
  const guard = (event, url) => {
    if (!isApplicationNavigation(url, entryPath)) event.preventDefault();
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
}
