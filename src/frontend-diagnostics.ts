export type FrontendEnvironmentSnapshot = {
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  vendor: string;
  cookieEnabled: boolean;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number;
  webdriver: boolean;
  devicePixelRatio: number;
  viewport: {
    width: number;
    height: number;
  };
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
    colorDepth: number;
    pixelDepth: number;
  };
  location: {
    href: string;
    pathname: string;
    search: string;
  };
};

export function getFrontendEnvironmentSnapshot(): FrontendEnvironmentSnapshot {
  const nav = window.navigator;
  const maybeNavigator = nav as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    languages: Array.from(nav.languages ?? []),
    vendor: nav.vendor,
    cookieEnabled: nav.cookieEnabled,
    hardwareConcurrency: nav.hardwareConcurrency || null,
    deviceMemory: maybeNavigator.deviceMemory ?? null,
    maxTouchPoints: nav.maxTouchPoints,
    webdriver: nav.webdriver,
    devicePixelRatio: window.devicePixelRatio,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
    },
    location: {
      href: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
    },
  };
}

export function getErrorDiagnostics(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack,
    };
  }
  return {
    name: typeof reason,
    message: String(reason),
    stack: undefined,
  };
}
