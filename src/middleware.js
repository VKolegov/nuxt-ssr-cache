const path = require('path');
const {serialize, deserialize} = require('./serializer');
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
 * @property {string | ((ctx: import('@nuxt/types').Context) => string) | null} cacheKeyPostfix
 */

function cleanIfNewVersion(cache, version) {
  if (!version) {
    return null;
  }
  return cache.getAsync('appVersion').then((oldVersion) => {
    if (oldVersion === version) {
      return null;
    }

    console.log(`Cache updated from ${oldVersion} to ${version}`);
    return cache.resetAsync();
    // unfortunately multi cache doesn't return a promise
    // and we can't await for it so as to store new version
    // immediately after reset.
  });
}

function tryStoreVersion(cache, version) {
  if (!version || cache.versionSaved) {
    return null;
  }
  return cache.setAsync('appVersion', version, {ttl: null}).then(() => {
    cache.versionSaved = true;
  });
}

/**
 *
 * @param {ModuleOptions} moduleOptions
 */
module.exports = function cacheRenderer(moduleOptions) {
  const {nuxt, options} = this;

  if (!moduleOptions || !nuxt.renderer) {
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
      console.log('[cache] SPA detected');
      return renderRoute(route, context);
    }

    // рендерим страницу и пишем её в кэш

    try {
      return await renderRoute(route, context);
    } catch (e) {
      if (e.code !== 999) {
        throw e;
      }

      // process cache

      let cacheKey = buildCacheKey(route, context);

      if (!cacheKey) {
        console.error('[cache] could not build cache key!');
      }

      if (e.cacheKeyPostfix) {
        cacheKey = `${cacheKey}_${e.cacheKeyPostfix}`;
      }

      // eslint-disable-next-line no-use-before-define
      return processCache(cacheKey, route, context);
    }
  };

  console.log('[cache] default renderRoute function overriden');

  async function processCache(key, route, context) {

    console.log(`[cache] checking cache key: ${key}`);

    try {
      const serializedRenderResult = await cache.getAsync(key);

      if (serializedRenderResult) {
        console.log('[cache middleware] cache found, deserializing');
        const renderResult = deserialize(serializedRenderResult);

        if (renderResult.html) {
          console.log('[cache middleware] cache found, deserialized, sending response...');

          return renderResult;
        }
        console.warn('[cache middleware] html not found in deserialized cache');
      }

    } catch (e) {
      console.error(e);
    }

    console.log(`[cache] rendering ${route} from scratch`);

    context.skipCacheCheck = true;
    const renderResult = await renderRoute(route, context);

    cache.setAsync(key, serialize(renderResult))
      .then(() => {
        console.log(`[cache] route ${route} cached using key ${key}`);
      });

    return renderResult;
  }

  return cache;
};
