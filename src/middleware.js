const path = require('path');
const {serialize} = require('./serializer');
const makeCache = require('./cache-builders');

/**
 *
 * @typedef {object} ModuleOptions
 * @property {boolean} useHostPrefix
 * @property {string|null} prefix
 * @property {object} store
 * @property {string} store.type
 * @property {string?} store.host
 * @property {string?} store.port
 * @property {number} store.ttl
 */

/**
 * @typedef {object} PageToCache
 * @property {string|RegExp} url
 * @property {number|null} ttl seconds
 * @property {string | ((ctx: import('@nuxt/types').Context) => string) | null} cacheKeyPostfix
 */

function cleanIfNewVersion(cache, version) {
  if (!version) {
    return null;
  }
  return cache
    .getAsync('appVersion')
    .then((oldVersion) => {
      if (oldVersion === version) {
        return null;
      }

      console.log(`Cache updated from ${oldVersion} to ${version}`);
      return cache.resetAsync().catch((e) => {
        console.error('[cache] error while resetting cache', e);
      });
      // unfortunately multi cache doesn't return a promise
      // and we can't await for it so as to store new version
      // immediately after reset.
    })
    .catch((e) => {
      console.error(`[cache] error while reading cache version`, e);
    });
}

function tryStoreVersion(cache, version) {
  if (!version || cache.versionSaved) {
    return null;
  }
  return cache
    .setAsync('appVersion', version, {ttl: null})
    .then(() => {
      cache.versionSaved = true;
    })
    .catch((e) => {
      console.error('[cache] error while saving app version', e);
    });
}

/**
 *
 * @param {ModuleOptions} moduleOptions
 */
module.exports = function cacheRenderer(moduleOptions) {
  const {nuxt, options} = this;

  if (!moduleOptions || !nuxt.renderer) {
    console.log('[cache] module options or nuxt renderer not found...', {
      moduleOptions,
      renderer: !!nuxt.renderer,
    });
    return null;
  }

  /**
   * Возвращает ключ для кэша
   * @param {string} route
   * @param {import('@nuxt/types').Context['ssrContext']} context
   * @returns {string}
   */
  function buildCacheKey(route, context) {
    let fullUrl = route;

    // Добавить к ключу префикс в виде имени хоста (напр. ourgold.local)
    if (moduleOptions.useHostPrefix) {
      const hostname =
        (context.req && context.req.hostname) ||
        (context.req && context.req.host) ||
        (context.req && context.req.headers && context.req.headers.host) ||
        (context.req && context.req.headers && context.req.headers.hostname);

      if (hostname) {
        fullUrl = path.join(hostname, route);
      }
    }

    let cacheKey;

    // /catalog/accessories/ -> catalog.accessories
    const routeString = fullUrl
      .split('/')
      .filter((char) => char !== '')
      .join('.');

    // кастомный префикс-ключ
    if (moduleOptions.prefix) {
      cacheKey = `${moduleOptions.prefix}:page:${routeString}`;
    } else {
      cacheKey = `page:${routeString}`;
    }

    return cacheKey;
  }

  const currentVersion = options.version || moduleOptions.version;
  console.info('[cache] creating cache handler using config: ', moduleOptions.store);
  const cache = makeCache(moduleOptions.store);
  cleanIfNewVersion(cache, currentVersion);

  // заменяем функцию рендера на нашу, с использованием кэша
  /**
   *
   * @type {import('@nuxt/vue-renderer')}
   */
  const renderer = nuxt.renderer;
  const renderRoute = renderer.renderRoute.bind(renderer);

  /**
   *
   * @param {string} route
   * @param {import('@nuxt/types').Context['ssrContext']} context ssr context
   * @returns {Promise<any>}
   */
  renderer.renderRoute = async (route, context) => {
    // hopefully cache reset is finished up to this point.

    tryStoreVersion(cache, currentVersion);

    if (context.spa) {
      // console.log('[cache] SPA detected');
      return renderRoute(route, context);
    }

    // рендерим страницу и пишем её в кэш

    try {

      // for middleware
      context.$ssrCache = {
        actions: cache,
        key: buildCacheKey(route, context),
        shouldCache: false,
      };

      // console.log(`[cache] waiting for render route ${route}...`);
      const renderResult = await renderRoute(route, context);

      if (context.$ssrCache.shouldCache) {
        // console.log(`[cache] render route ${route} finished, caching...`);

        const key = context.$ssrCache.postfix
          ? `${context.$ssrCache.key}_${context.$ssrCache.postfix}`
          : context.$ssrCache.key;

        const ttl = context.$ssrCache.ttl || moduleOptions.store.ttl || 10 * 60;

        cache
          .setAsync(key, serialize(renderResult), {ttl})
          .then(() => {
            console.info(`[cache] route ${route} cached using key ${key}, ttl ${ttl}`);
          })
          .catch((e) => {
            console.error(`[cache] error while caching ${route}`, e);
          });
      }

      // console.log(`[cache] render route ${route} finished`);

      return renderResult;
    } catch (e) {
      if (e.code !== 999) {
        throw e;
      }

      // return from cache

      if (!e.cachedContent) {
        throw new Error(`[cache] no cached content found`);
      }

      return e.cachedContent;
    }
  };

  console.log('[cache] Nuxt SSR caching is online');

  return cache;
};
