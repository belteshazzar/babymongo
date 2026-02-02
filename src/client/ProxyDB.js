import { ProxyCollection } from './ProxyCollection.js';
import { ProxyChangeStream } from './ProxyChangeStream.js';

/**
 * ProxyDB lives on the main thread and forwards operations to the worker Server.
 */
export class ProxyDB {
  constructor({ dbName, bridge, options = {} }) {
    this.dbName = dbName;
    this.bridge = bridge;
    this.options = options;

    // Proxy to auto-create collections on property access
    const dbMethodNames = new Set([
      'getCollectionNames',
      'getCollectionInfos',
      'createCollection',
      'dropCollection',
      'dropDatabase',
      'collection',
      'getCollection',
      'watch'
    ]);

    this._methodNames = dbMethodNames;

    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === 'symbol' || String(prop).startsWith('_')) return undefined;

        if (dbMethodNames.has(prop)) {
          if (prop === 'watch') {
            return (...args) => target._watch(...args);
          }
          return (...args) => target._call(String(prop), args);
        }

        // Dynamic collection access
        return target.collection(prop, receiver);
      }
    });
  }

  collection(name, dbProxy) {
    return new ProxyCollection({
      dbName: this.dbName,
      name,
      bridge: this.bridge,
      db: dbProxy || this
    });
  }

  async close() {
    return undefined;
  }

  _call(method, args = []) {
    const promise = this.bridge.sendRequest({
      target: 'db',
      database: this.dbName,
      method,
      args
    }).then((res) => {
      if (res && res.streamId) {
        return ProxyChangeStream.create({
          bridge: this.bridge,
          database: this.dbName,
          collection: null,
          streamId: res.streamId
        });
      }
      return res;
    });
    return promise;
  }

  _watch(pipeline = [], options = {}) {
    return ProxyChangeStream.create({
      bridge: this.bridge,
      database: this.dbName,
      collection: null,
      pipeline,
      options
    });
  }
}
