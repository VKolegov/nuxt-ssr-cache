const cacheManager = require('cache-manager');
const {promisify} = require("util");

function memoryCache(config) {
  return cacheManager.caching({
    store: 'memory',
    ...config,
  });
}

function redisCache(config) {
  if (config && Array.isArray(config.configure)) {
    const redis = require('redis');
    const client = redis.createClient({
      retry_strategy() {
      },
      ...config,
    });

    Promise
      .all(config.configure.map(options => new Promise((resolve, reject) => {
        client.config('SET', ...options, function (err, result) {
          if (err || result !== 'OK') {
            reject(err);
          } else {
            resolve(result);
          }
        });
      })))
      .then(() => client.quit());
  }

  return cacheManager.caching({
    store: require('cache-manager-redis'),
    retry_strategy() {
    },
    ...config,
  });
}

function memcachedCache(config) {
  return cacheManager.caching({
    store: require('cache-manager-memcached-store'),
    ...config,
  });
}

function multiCache(config) {
  const stores = config.stores.map(makeCache);
  return cacheManager.multiCaching(stores);
}

const cacheBuilders = {
  memory: memoryCache,
  multi: multiCache,
  redis: redisCache,
  memcached: memcachedCache,
};

function makeCache(config = {type: 'memory'}) {
  const builder = cacheBuilders[config.type];
  if (!builder) {
    throw new Error('Unknown store type: ' + config.type)
  }

  const cacheStore = builder(config);

  /**
   * TODO: update jsdoc
   * @type {(key: string) => Promise<any>}
   */
  const getAsync = promisify(cacheStore.get).bind(cacheStore);
  /**
   * TODO: update jsdoc
   * @type {(key: string, value: string, options: {ttl: number}|null) => Promise<any>}
   */
  const setAsync = promisify(cacheStore.set).bind(cacheStore);
  /**
   * TODO: update jsdoc
   * @type {(key: string) => Promise<void>}
   */
  const delAsync = promisify(cacheStore.del).bind(cacheStore);
  /**
   * TODO: update jsdoc
   * @type {() => Promise<void>}
   */
  const resetAsync = promisify(cacheStore.reset).bind(cacheStore);

  return {
    ...cacheStore,
    getAsync,
    setAsync,
    delAsync,
    resetAsync,
  };
}

module.exports = makeCache;
