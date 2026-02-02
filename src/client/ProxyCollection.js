import { ProxyChangeStream } from './ProxyChangeStream.js';
import { ProxyCursor } from './ProxyCursor.js';
import { NotImplementedError, QueryError, ErrorCodes } from '../errors.js';

/**
 * ProxyCollection lives on the main thread and forwards operations to the worker Server.
 */
export class ProxyCollection {
  constructor({ dbName, name, bridge, db }) {
    this.dbName = dbName;
    this.name = name;
    this.bridge = bridge;
    this._db = db; // Reference to ProxyDB for registering new collections

    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === 'symbol' || String(prop).startsWith('_')) return undefined;
        if (prop === 'watch') {
          return (...args) => target._watch(...args);
        }
        // Special handling for methods that return cursors - return cursor immediately
        if (prop === 'find' || prop === 'aggregate') {
          return (...args) => target._cursorMethod(String(prop), args);
        }
        return (...args) => target._call(String(prop), args);
      }
    });
  }

  _cursorMethod(method, args = []) {
    // Validate projection for find() calls to catch errors early
    if (method === 'find' && args.length >= 2) {
      this._validateProjection(args[1]);
    }
    
    // Return cursor immediately - it will fetch data asynchronously with delayed execution
    const requestPayload = {
      target: 'collection',
      database: this.dbName,
      collection: this.name,
      method,
      args
    };

    const cursor = new ProxyCursor({
      bridge: this.bridge,
      requestPayload
    });

    // For aggregate, also make the cursor thenable so await works like in older API
    if (method === 'aggregate') {
      cursor.then = function(onFulfilled, onRejected) {
        return this.toArray().then(onFulfilled, onRejected);
      };
    }

    return cursor;
  }

  _validateProjection(projection) {
    if (!projection || Object.keys(projection).length === 0) return;
    
    const keys = Object.keys(projection);
    let hasInclusion = false;
    let hasExclusion = false;

    for (const key of keys) {
      if (key === '_id') continue; // _id can appear with either style
      if (projection[key]) hasInclusion = true; else hasExclusion = true;
      if (hasInclusion && hasExclusion) break;
    }

    if (hasInclusion && hasExclusion) {
      throw new QueryError("Cannot do exclusion on field in inclusion projection", {
        code: ErrorCodes.CANNOT_DO_EXCLUSION_ON_FIELD_ID_IN_INCLUSION_PROJECTION,
        collection: this.name
      });
    }
  }

  _call(method, args = []) {
    const promise = this.bridge.sendRequest({
      target: 'collection',
      database: this.dbName,
      collection: this.name,
      method,
      args
    }).then((res) => {
      if (res && res.cursorId) {
        return new ProxyCursor({
          bridge: this.bridge,
          cursorId: res.cursorId,
          batch: res.batch,
          exhausted: res.exhausted,
          batchSize: res.batchSize
        });
      }
      // If copyTo, register the destination collection locally
      if (method === 'copyTo' && args.length > 0) {
        // Access the destination collection to register it
        // This assumes we have access to the database proxy
        // We'll need to pass db reference to ProxyCollection
        if (this._db) {
          this._db.collection(args[0]);
        }
      }
      return res;
    });
    return promise;
  }

  getIndexes() {
    // Forward to worker instead of using per-instance cache
    // This enables proper multi-client synchronization
    return this._call('getIndexes', []);
  }

  _watch(pipeline = [], options = {}) {
    return ProxyChangeStream.create({
      bridge: this.bridge,
      database: this.dbName,
      collection: this.name,
      pipeline,
      options
    });
  }
}
