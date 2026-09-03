// Global fetch-activity indicator. Wraps window.fetch so every network request in the
// app — current and future, anywhere in this codebase — drives a top progress bar with
// no per-call-site instrumentation. Side-effect only module: must be imported (for its
// effect) before any other module calls fetch, so main.js imports it first.
import { globalLoadingBar } from './dom.js';

let inFlightRequests = 0;
let loadingBarHideTimer = null;
const nativeFetch = window.fetch.bind(window);

window.fetch = function (...args) {
  inFlightRequests++;
  if (globalLoadingBar) {
    clearTimeout(loadingBarHideTimer);
    globalLoadingBar.classList.remove('done');
    globalLoadingBar.classList.add('active');
  }
  return nativeFetch(...args).finally(() => {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
    if (inFlightRequests === 0 && globalLoadingBar) {
      globalLoadingBar.classList.remove('active');
      globalLoadingBar.classList.add('done');
      loadingBarHideTimer = setTimeout(() => globalLoadingBar.classList.remove('done'), 400);
    }
  });
};
