/**
 *
 * @param {PageToCache[]|string[]} pages
 * @param {boolean} ssr
 * @returns {(function(context: import('@nuxt/types').Context): Promise<void>)|*}
 */
export function makeSsrCacheMiddleware(pages, ssr) {


  function getPageByPath(routePath) {

    for (const page of pages) {
      const url =
        typeof page === 'string' || page instanceof RegExp ? page : page.url;

      const regexpMatch = url instanceof RegExp && url.test(routePath);

      if (regexpMatch) {
        return page;
      }

      const stringMatch = typeof url === 'string' && routePath.startsWith(url);

      if (stringMatch) {
        return page;
      }
    }

    return null;
  }


  return async context => {

    if (context.ssrContext?.skipCacheCheck) {
      return;
    }

    const route = context.route.fullPath;

    console.log(`[cache middleware] route ${route}`);

    if (!ssr) {
      console.log('[cache middleware] not SSR, skipping');
      return;
    }

    const page = getPageByPath(route);

    if (!page) {
      return;
    }

    console.log(`[cache middleware] ${route} is going to be cached`);

    let cacheKeyPostfix = null;

    if (typeof page.cacheKeyPostfix === 'string') {
      cacheKeyPostfix = page.cacheKeyPostfix;
    } else if (typeof page.cacheKeyPostfix === 'function') {
      cacheKeyPostfix = page.cacheKeyPostfix(context);
    }

    const message = new Error('Process page cache');

    message.code = 999;
    message.cacheKeyPostfix = cacheKeyPostfix;

    throw message;
  };
}
