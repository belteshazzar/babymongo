import { Collection } from './Collection.js';
import { ObjectId } from '@belteshazzar/binjson';
import { ChangeStream } from './ChangeStream.js';
import { NotImplementedError } from '../errors.js';

/**
 * DB class
 */
export class DB {
	constructor(options) {
		this.options = options || {};
    this.baseFolder = this.options.baseFolder || 'babymongo';
		this.dbName = this.options.dbName || 'default';
		this.dbFolder = `${this.baseFolder}/${this.dbName}`;
    this.collections = new Map();

		// Return a Proxy to enable dynamic collection creation
		const proxy = new Proxy(this, {
			get(target, property, receiver) {
				// If property exists on target (including undefined values), return it
				if (property in target) {
					return Reflect.get(target, property, receiver);
				}

				// If property is a symbol or special property, return undefined
				if (typeof property === 'symbol' || property.startsWith('_')) {
					return undefined;
				}

        // Only auto-create if it's a valid collection name and doesn't already exist
        if (typeof property === 'string') {
          return target.getCollection(property);
        }

        return undefined;
			}
		});
		
		// Store reference to proxy for use in getCollection
		this._proxy = proxy;
		
		return proxy;
	}

	/**
	 * Close all collections
	 */
	async close() {
    for (const [_, collection] of this.collections) {
      await collection.close();
		}
	}

	// DB Methods
	cloneCollection() { throw new NotImplementedError('cloneCollection', { database: this.dbName }); }
	cloneDatabase() { throw new NotImplementedError('cloneDatabase', { database: this.dbName }); }
	commandHelp() { throw new NotImplementedError('commandHelp', { database: this.dbName }); }
	copyDatabase() { throw new NotImplementedError('copyDatabase', { database: this.dbName }); }

	createCollection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Collection(this, name));
    }
    return {ok:1};
  }

	currentOp() { throw new NotImplementedError('currentOp', { database: this.dbName }); }

	async dropCollection(collectionName) {
    if (this.collections.has(collectionName)) {
      const collection = this.collections.get(collectionName);
      if (typeof collection.drop === 'function') {
        await collection.drop();
      }
      this.collections.delete(collectionName);
    }
  }

	async dropDatabase() {
    for (const [_, collection] of this.collections) {
      await collection.drop();
		}
    this.collections.clear();
    
    const pathParts = this.dbFolder.split('/').filter(Boolean);
    const dbFolder = pathParts.pop();

    try {
      let dir = await globalThis.navigator.storage.getDirectory();
      for (const part of pathParts) {
        dir = await dir.getDirectoryHandle(part, { create: false });
      }
      
      await dir.removeEntry(dbFolder, { recursive: true });
    } catch (error) {
      // Ignore not found errors - directory might not exist yet
      if (error.name !== 'NotFoundError' && error.code !== 'ENOENT') {
        throw error;
      }
    }
    return {ok: 1};
  }

	eval() { throw new NotImplementedError('eval', { database: this.dbName }); }
	fsyncLock() { throw new NotImplementedError('fsyncLock', { database: this.dbName }); }
	fsyncUnlock() { throw new NotImplementedError('fsyncUnlock', { database: this.dbName }); }

  getCollection(name) { 
    // For collection names, create the collection if it doesn't exist
    if (!this.collections.has(name)) {
      // Pass the proxy (if available) so collections can access other collections via db
      const dbRef = this._proxy || this;
      this.collections.set(name, new Collection(dbRef, name));
    }

    return this.collections.get(name);
  }
  
  // Alias for getCollection for MongoDB API compatibility
  collection(name) {
    return this.getCollection(name);
  }

  getCollectionInfos() { throw new NotImplementedError('getCollectionInfos', { database: this.dbName }); }
  async getCollectionNames() {
    // Discover collections from persistent storage (OPFS)
    const discoveredNames = new Set();
    
    // First, check if OPFS is available
    if (globalThis.navigator?.storage?.getDirectory) {
      try {
        // Navigate to the database folder
        const parts = this.dbFolder.split('/').filter(Boolean);
        let dirHandle = await globalThis.navigator.storage.getDirectory();
        
        for (const part of parts) {
          dirHandle = await dirHandle.getDirectoryHandle(part, { create: false });
        }
        
        // Enumerate collection directories
        for await (const [name, handle] of dirHandle.entries()) {
          if (handle.kind === 'directory') {
            discoveredNames.add(name);
          }
        }
      } catch (err) {
        // If database folder doesn't exist yet, that's okay - no collections
        if (err?.name !== 'NotFoundError' && err?.code !== 'ENOENT') {
          // Log unexpected errors but don't fail
          console.warn(`Error discovering collections in ${this.dbFolder}:`, err);
        }
      }
    }
    
    // Merge with in-memory collections (in case some were just created)
    for (const name of this.collections.keys()) {
      discoveredNames.add(name);
    }
    
    return Array.from(discoveredNames);
  }
	getLastError() { throw new NotImplementedError('getLastError', { database: this.dbName }); }
	getLastErrorObj() { throw new NotImplementedError('getLastErrorObj', { database: this.dbName }); }
	getLogComponents() { throw new NotImplementedError('getLogComponents', { database: this.dbName }); }
	getMongo() { throw new NotImplementedError('getMongo', { database: this.dbName }); }
	getName() { throw new NotImplementedError('getName', { database: this.dbName }); }
	getPrevError() { throw new NotImplementedError('getPrevError', { database: this.dbName }); }
	getProfilingLevel() { throw new NotImplementedError('getProfilingLevel', { database: this.dbName }); }
	getProfilingStatus() { throw new NotImplementedError('getProfilingStatus', { database: this.dbName }); }
	getReplicationInfo() { throw new NotImplementedError('getReplicationInfo', { database: this.dbName }); }
	getSiblingDB() { throw new NotImplementedError('getSiblingDB', { database: this.dbName }); }

	help() {
		console.log("        help mr                      mapreduce");
		console.log("        db.foo.find()                list objects in collection foo");
		console.log("        db.foo.find( { a : 1 } )     list objects in foo where a == 1");
		console.log("        it                           result of the last line evaluated; use to further iterate");
	}

	hostInfo() { throw new NotImplementedError('hostInfo', { database: this.dbName }); }
	isMaster() { throw new NotImplementedError('isMaster', { database: this.dbName }); }
	killOp() { throw new NotImplementedError('killOp', { database: this.dbName }); }
	listCommands() { throw new NotImplementedError('listCommands', { database: this.dbName }); }
	loadServerScripts() { throw new NotImplementedError('loadServerScripts', { database: this.dbName }); }
	logout() { throw new NotImplementedError('logout', { database: this.dbName }); }
	printCollectionStats() { throw new NotImplementedError('printCollectionStats', { database: this.dbName }); }
	printReplicationInfo() { throw new NotImplementedError('printReplicationInfo', { database: this.dbName }); }
	printShardingStatus() { throw new NotImplementedError('printShardingStatus', { database: this.dbName }); }
	printSlaveReplicationInfo() { throw new NotImplementedError('printSlaveReplicationInfo', { database: this.dbName }); }
	repairDatabase() { throw new NotImplementedError('repairDatabase', { database: this.dbName }); }
	resetError() { throw new NotImplementedError('resetError', { database: this.dbName }); }
	runCommand() { throw new NotImplementedError('runCommand', { database: this.dbName }); }
	serverBuildInfo() { throw new NotImplementedError('serverBuildInfo', { database: this.dbName }); }
	serverCmdLineOpts() { throw new NotImplementedError('serverCmdLineOpts', { database: this.dbName }); }
	serverStatus() { throw new NotImplementedError('serverStatus', { database: this.dbName }); }
	setLogLevel() { throw new NotImplementedError('setLogLevel', { database: this.dbName }); }
	setProfilingLevel() { throw new NotImplementedError('setProfilingLevel', { database: this.dbName }); }
	shutdownServer() { throw new NotImplementedError('shutdownServer', { database: this.dbName }); }
	stats() { throw new NotImplementedError('stats', { database: this.dbName }); }
	version() { throw new NotImplementedError('version', { database: this.dbName }); }
	upgradeCheck() { throw new NotImplementedError('upgradeCheck', { database: this.dbName }); }
	upgradeCheckAllDBs() { throw new NotImplementedError('upgradeCheckAllDBs', { database: this.dbName }); }

	/**
	 * Watch for changes across all collections in this database
	 * @param {Array} pipeline - Aggregation pipeline to filter changes
	 * @param {Object} options - Watch options
	 * @returns {ChangeStream} A change stream instance
	 */
	watch(pipeline = [], options = {}) {
		return new ChangeStream(this, pipeline, options);
	}
}
