// Side panel = extension origin, no ?ctx=tab. Popout tab uses ?ctx=tab.
export const IS_SIDE_PANEL: boolean =
  typeof window !== "undefined" &&
  window.location.protocol === "chrome-extension:" &&
  new URLSearchParams(window.location.search).get("ctx") !== "tab";
