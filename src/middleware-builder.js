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
        console.log(`${routePath} matched by ${url.toString()}`);
        return page;
      }

      const stringMatch = typeof url === 'string' && routePath.startsWith(url);

      if (stringMatch) {
        console.log(`${routePath} matched by ${url.toString()}`);
        return page;
      }
    }

    return null;
  }

  async function getPageFromCache($ssrCache, keyPostfix = null) {
    const key = keyPostfix ? `${$ssrCache.key}_${keyPostfix}` : $ssrCache.key;

    // console.log(`[cache middleware] checking cache key: ${key}`);

    try {
      const serializedRenderResult = await $ssrCache.actions.getAsync(key);

      if (serializedRenderResult) {
        // console.log('[cache middleware] cache found, deserializing');
        // const renderResult = deserialize(serializedRenderResult);
        const renderResult = serializedRenderResult;

        if (renderResult.html) {
          // console.log(
          //   '[cache middleware] cache found, deserialized, sending response...'
          // );

          return renderResult;
        }
        console.warn('[cache middleware] html not found in deserialized cache');
      }
      // else {
      //   console.log(`[cache middleware] cache not found for key ${key}`);
      // }
    } catch (e) {
      console.error(`[cache middleware] error while reading cache for`, e);
    }

    return null;
  }

  return async (context) => {
    const route = context.route.fullPath;

    if (!ssr) {
      // console.log('[cache middleware] not SSR, skipping');
      return;
    }

    const page = getPageByPath(route);

    if (!page) {
      return;
    }

    // console.log(`[cache middleware] ${route} is under cache mechanism`);

    let cacheKeyPostfix = null;

    if (typeof page.cacheKeyPostfix === 'string') {
      cacheKeyPostfix = page.cacheKeyPostfix;
    } else if (typeof page.cacheKeyPostfix === 'function') {
      cacheKeyPostfix = page.cacheKeyPostfix(context);
    }

    const cachedContent = await getPageFromCache(
      context.ssrContext.$ssrCache,
      cacheKeyPostfix
    );

    if (!cachedContent) {
      // console.log(`[cache middleware] ${route} is going to be cached`);
      context.ssrContext.$ssrCache.shouldCache = true;
      context.ssrContext.$ssrCache.ttl = page.ttl;
      context.ssrContext.$ssrCache.postfix = cacheKeyPostfix;
      return;
    }

    const message = new Error('Cache detected');

    message.code = 999;
    message.cachedContent = cachedContent;

    throw message;
  };
}
