/** True inside the Moonfold Android app, which appends this marker to its web view's user agent. */
export function isMobileApp(): boolean {
  return /\bMoonfoldMobile\//.test(navigator.userAgent);
}
