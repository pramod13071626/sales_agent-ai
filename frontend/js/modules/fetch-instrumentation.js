// Global fetch-activity indicator + auth plumbing. Wraps window.fetch so every
// network request in the app — current and future, anywhere in this codebase —
// drives a top progress bar with no per-call-site instrumentation, and (once a
// user is logged in) carries the access token and transparently retries once
// on a 401 after a silent refresh. Side-effect only module: must be imported
// (for its effect) before any other module calls fetch, so main.js imports it
// first.
//
// A no-op with respect to auth until someone actually logs in — getAccessToken()
// returns null until then, so no header is added and no request behaves any
// differently than before this existed (auth isn't enforced yet either way;
// see AUTH_JWT_IMPLEMENTATION_PLAN.md §9 Phase 3).
import { globalLoadingBar } from './dom.js';
import { getAccessToken, refreshAccessToken } from './auth-client.js';

let inFlightRequests = 0;
let loadingBarHideTimer = null;
const nativeFetch = window.fetch.bind(window);

// auth-client.js's own login/refresh/logout calls use nativeFetch directly
// (see its header comment) specifically so those never re-enter this 401
// handling — this list is a second, belt-and-suspenders guard against ever
// trying to "refresh after a failed refresh".
const _AUTH_ENDPOINTS = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];

function _requestUrl(input) {
  return typeof input === 'string' ? input : (input && input.url) || '';
}

function _isApiRequest(input) {
  const url = _requestUrl(input);
  return url.startsWith('/api/') || url.includes('/api/');
}

function _withAuthHeader(input, init) {
  const token = getAccessToken();
  if (!token) return init;
  const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

window.fetch = function (input, init) {
  inFlightRequests++;
  if (globalLoadingBar) {
    clearTimeout(loadingBarHideTimer);
    globalLoadingBar.classList.remove('done');
    globalLoadingBar.classList.add('active');
  }

  const requestUrl = _requestUrl(input);
  const isAuthEndpoint = _AUTH_ENDPOINTS.some(p => requestUrl.includes(p));
  const finish = () => {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
    if (inFlightRequests === 0 && globalLoadingBar) {
      globalLoadingBar.classList.remove('active');
      globalLoadingBar.classList.add('done');
      loadingBarHideTimer = setTimeout(() => globalLoadingBar.classList.remove('done'), 400);
    }
  };

  const augmentedInit = _isApiRequest(input) ? _withAuthHeader(input, init) : init;

  return nativeFetch(input, augmentedInit).then(async (res) => {
    if (res.status !== 401 || isAuthEndpoint || !getAccessToken()) {
      finish();
      return res;
    }
    // Access token expired mid-session — try one silent refresh, then retry
    // the original request exactly once with the new token.
    const newToken = await refreshAccessToken();
    finish();
    if (!newToken) return res; // refresh itself failed — surface the original 401
    return window.fetch(input, init);
  }).catch((err) => {
    finish();
    throw err;
  });
};
