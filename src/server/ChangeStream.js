import { EventEmitter } from 'events';
import { matches } from './queryMatcher.js';

/**
 * ChangeStream watches for changes in collections and emits change events
 * Compatible with MongoDB Change Streams API
 */
export class ChangeStream extends EventEmitter {
	constructor(target, pipeline = [], options = {}) {
		super();
		
		this.target = target; // MongoClient, DB, or Collection
		this.pipeline = pipeline;
		this.options = options;
		this.closed = false;
		this._listeners = new Map();
		this._changeCounter = 0;
		
		// Start watching immediately (asynchronously but don't await)
		this._startWatching().catch(err => {
			console.error('Error starting change stream watch:', err);
		});
	}

	/**
	 * Check if target is a DB instance (handles Proxies and minification)
	 */
	_isDB(target) {
		// Check for DB-specific properties that won't trigger collection creation
		// Use hasOwnProperty or check the collections Map directly
		return target && 
			typeof target.dbName === 'string' && 
			typeof target.getCollectionNames === 'function' &&
			target.collections instanceof Map;
	}

	/**
	 * Check if target is a Server instance
	 */
	_isServer(target) {
		return target && 
			target.databases instanceof Map &&
			typeof target._getDB === 'function';
	}

	/**
	 * Check if target is a MongoClient instance
	 */
	_isMongoClient(target) {
		return target && 
			typeof target.connect === 'function' &&
			typeof target.db === 'function' &&
			target.constructor.name === 'MongoClient'; // MongoClient is not minified same way
	}

	/**
	 * Start watching for changes
	 * @private
	 */
	async _startWatching() {
		if (this.closed) return;
		
		const collections = await this._getCollectionsToWatch();
		
		for (const collection of collections) {
			this._watchCollection(collection);
		}
		
		// For Server watching, intercept _getDB calls
		if (this._isServer(this.target)) {
			this._interceptServerDBCreation();
		}
		
		// For DB watching, we also need to intercept new collection creation
		if (this._isDB(this.target)) {
			this._interceptDBCollectionCreation();
		}
		
		// For MongoClient watching, intercept db() calls
		if (this._isMongoClient(this.target)) {
			this._interceptClientDBCreation();
		}
	}

	/**
	 * Get collections to watch based on target type
	 * @private
	 */
	async _getCollectionsToWatch() {
		const collections = [];
		
		// Server - watch all collections in all databases
		if (this._isServer(this.target)) {
			// Watch all existing databases
			for (const [dbName, db] of this.target.databases) {
				const collectionNames = await db.getCollectionNames();
				for (const name of collectionNames) {
					const collection = db[name];
					if (collection && collection.isCollection) {
						collections.push(collection);
					}
				}
			}
			return collections;
		}
		
		// MongoClient - watch all collections in all databases
		if (this._isMongoClient(this.target)) {
			// Store reference to monitor for new databases/collections
			this._monitorClient();
			return collections;
		}
		
		// DB - watch all collections in the database
		if (this._isDB(this.target)) {
			const collectionNames = await this.target.getCollectionNames();
			for (const name of collectionNames) {
				const collection = this.target[name];
				if (collection && collection.isCollection) {
					collections.push(collection);
				}
			}
			// Also monitor for new collections
			this._monitorDB();
		}
		
		// Collection - watch specific collection
		if (this.target.isCollection) {
			collections.push(this.target);
		}
		
		return collections;
	}

	/**
	 * Watch a specific collection for changes
	 * @private
	 */
	_watchCollection(collection) {
		if (this.closed) return;
		if (!collection) return; // Skip null/undefined
		if (typeof collection.on !== 'function') return; // Skip non-EventEmitters
		if (!collection.isCollection) return; // Skip non-collections
		if (this._listeners.has(collection)) return; // Already watching
		
		const handlers = {
			insert: (doc) => this._emitChange('insert', collection, doc),
			update: (doc, updateDescription) => this._emitChange('update', collection, doc, updateDescription),
			replace: (doc) => this._emitChange('replace', collection, doc),
			delete: (doc) => this._emitChange('delete', collection, doc)
		};
		
		// Store handlers for cleanup
		this._listeners.set(collection, handlers);
		
		// Listen to collection change events
		collection.on('insert', handlers.insert);
		collection.on('update', handlers.update);
		collection.on('replace', handlers.replace);
		collection.on('delete', handlers.delete);
	}

	/**
	 * Emit a change event
	 * @private
	 */
	_emitChange(operationType, collection, doc, updateDescription = null) {
		if (this.closed) return;
		
		const changeEvent = this._createChangeEvent(
			operationType,
			collection,
			doc,
			updateDescription
		);
		
		// Apply pipeline filters if any
		if (!this._matchesPipeline(changeEvent)) {
			return;
		}
		
		this.emit('change', changeEvent);
	}

	/**
	 * Create a MongoDB-compatible change event document
	 * @private
	 */
	_createChangeEvent(operationType, collection, doc, updateDescription) {
		const event = {
			_id: {
				_data: btoa(String(++this._changeCounter))
			},
			operationType,
			clusterTime: new Date(),
			ns: {
				db: collection.db.dbName,
				coll: collection.name
			},
			documentKey: {
				_id: doc._id
			}
		};
		
		switch (operationType) {
			case 'insert':
				event.fullDocument = doc;
				break;
				
			case 'update':
				event.updateDescription = updateDescription || {
					updatedFields: {},
					removedFields: [],
					truncatedArrays: []
				};
				// Include full document if requested
				if (this.options.fullDocument === 'updateLookup') {
					event.fullDocument = doc;
				}
				break;
				
			case 'replace':
				event.fullDocument = doc;
				break;
				
			case 'delete':
				// For delete, doc contains the deleted document's _id
				break;
		}
		
		return event;
	}

	/**
	 * Check if change event matches pipeline filters
	 * @private
	 */
	_matchesPipeline(changeEvent) {
		if (!this.pipeline || this.pipeline.length === 0) {
			return true;
		}
		
		// Process pipeline stages
		for (const stage of this.pipeline) {
			if (stage.$match) {
				// Use the same query matcher as find()
				// Note: matches(document, query) - document first, query second
				if (!matches(changeEvent, stage.$match)) {
					return false;
				}
			}
		}
		
		return true;
	}

	/**
	 * Get nested value from object using dot notation
	 * @private
	 */
	_getNestedValue(obj, path) {
		return path.split('.').reduce((current, part) => current?.[part], obj);
	}

	/**
	 * Monitor client for new databases/collections (simplified)
	 * @private
	 */
	_monitorClient() {
		// Handled by _interceptClientDBCreation
	}

	/**
	 * Intercept DB creation on a MongoClient
	 * @private
	 */
	_interceptClientDBCreation() {
		const client = this.target;
		const originalDb = client.db.bind(client);
		const self = this;
		
		// Track databases we're watching
		this._watchedDBs = new Map();
		
		// Override db() method to watch new databases
		client.db = function(name, opts) {
			const database = originalDb(name, opts);
			const dbName = database.dbName;
			
			// Only set up watch once per database
			if (!self._watchedDBs.has(dbName)) {
				self._watchedDBs.set(dbName, database);
				
				// Watch existing collections in this database (async)
				database.getCollectionNames().then(collectionNames => {
					for (const colName of collectionNames) {
						const col = database[colName];
						if (col && col.isCollection && !self._listeners.has(col)) {
							self._watchCollection(col);
						}
					}
				}).catch(err => {
					console.warn('Error discovering collections for watch:', err);
				});
				
				// Intercept new collection creation on this database
				self._interceptDBCollectionCreationForClient(database);
			}
			
			return database;
		};
		
		// Store original for cleanup
		this._originalClientMethods = { db: originalDb };
	}

	/**
	 * Intercept DB creation on a Server
	 * @private
	 */
	_interceptServerDBCreation() {
		const server = this.target;
		const originalGetDB = server._getDB.bind(server);
		const self = this;
		
		// Track databases we're watching
		this._watchedDBs = new Map();
		
		// Override _getDB() method to watch new databases
		server._getDB = function(dbName) {
			const db = originalGetDB(dbName);
			
			// Only set up watch once per database
			if (!self._watchedDBs.has(dbName)) {
				self._watchedDBs.set(dbName, db);
				
				// Watch existing collections in this database (async)
				db.getCollectionNames().then(collectionNames => {
					for (const colName of collectionNames) {
						const col = db[colName];
						if (col && col.isCollection && !self._listeners.has(col)) {
							self._watchCollection(col);
						}
					}
				}).catch(err => {
					console.warn('Error discovering collections for watch:', err);
				});
				
				// Intercept new collection creation on this database
				self._interceptDBCollectionCreationForServer(db);
			}
			
			return db;
		};
		
		// Store original for cleanup
		this._originalServerMethods = { _getDB: originalGetDB };
	}

	/**
	 * Intercept collection creation for a database in server watch mode
	 * @private
	 */
	_interceptDBCollectionCreationForServer(db) {
		const originalCollection = db.collection.bind(db);
		const originalCreateCollection = db.createCollection.bind(db);
		const self = this;
		
		db.collection = function(name) {
			const col = originalCollection(name);
			if (col && col.isCollection && !self._listeners.has(col)) {
				self._watchCollection(col);
			}
			return col;
		};
		
		db.createCollection = function(name) {
			originalCreateCollection(name);
			const col = db[name];
			if (col && col.isCollection && !self._listeners.has(col)) {
				self._watchCollection(col);
			}
		};
	}

	/**
	 * Intercept collection creation for a database in client watch mode
	 * @private
	 */
	_interceptDBCollectionCreationForClient(db) {
		const originalCollection = db.collection.bind(db);
		const originalCreateCollection = db.createCollection.bind(db);
		const self = this;
		
		db.collection = function(name) {
			const col = originalCollection(name);
			if (col && col.isCollection && !self._listeners.has(col)) {
				self._watchCollection(col);
			}
			return col;
		};
		
		db.createCollection = function(name) {
			originalCreateCollection(name);
			const col = db[name];
			if (col && col.isCollection && !self._listeners.has(col)) {
				self._watchCollection(col);
			}
		};
	}

	/**
	 * Monitor database for new collections
	 * @private
	 */
	_monitorDB() {
		// Handled by _interceptDBCollectionCreation
	}

	/**
	 * Intercept new collection creation on a DB
	 * @private
	 */
	_interceptDBCollectionCreation() {
		// Since DB is a Proxy, we need to override getCollection() on the target, not collection() on the proxy
		// The Proxy's get trap will always return methods from the target via Reflect.get
		const db = this.target;
		
		// Get the actual DB instance (not the proxy) by accessing _proxy property or finding it
		// The DB constructor stores 'this' before returning the proxy, so we can access it
		let actualDB = db;
		// If db has _proxy, it means db IS the proxy and we need to get through to the real target
		// But we can't easily do that. Instead, we need to override on the object itself.
		// The trick is to override getCollection, since that's what collection() calls
		
		const originalGetCollection = db.getCollection.bind(db);
		const originalCreateCollection = db.createCollection ? db.createCollection.bind(db) : null;
		const self = this;
		
		// Override getCollection() method to watch new collections
		db.getCollection = function(name) {
			const col = originalGetCollection(name);
			// Watch this collection if we haven't already
			if (col && col.isCollection && !self._listeners.has(col)) {
				self._watchCollection(col);
			}
			return col;
		};
		
		// Override createCollection() method if it exists
		if (originalCreateCollection) {
			db.createCollection = function(name) {
				originalCreateCollection(name);
				const col = db[name];
				if (col && col.isCollection && !self._listeners.has(col)) {
					self._watchCollection(col);
				}
			};
		}
		
		// Store originals for cleanup
		this._originalDBMethods = { 
			getCollection: originalGetCollection, 
			createCollection: originalCreateCollection 
		};
	}

	/**
	 * Close the change stream
	 */
	close() {
		if (this.closed) return;
		
		this.closed = true;
		
		// Remove all collection listeners
		for (const [collection, handlers] of this._listeners) {
			collection.off('insert', handlers.insert);
			collection.off('update', handlers.update);
			collection.off('replace', handlers.replace);
			collection.off('delete', handlers.delete);
		}
		
		this._listeners.clear();
		
		// Restore original Server methods if we intercepted them
		if (this._originalServerMethods && this.target.constructor.name === 'Server') {
			this.target._getDB = this._originalServerMethods._getDB;
		}
		
		// Restore original DB methods if we intercepted them
		if (this._originalDBMethods && this.target.constructor.name === 'DB') {
			this.target.collection = this._originalDBMethods.collection;
			this.target.createCollection = this._originalDBMethods.createCollection;
		}
		
		// Restore original MongoClient methods if we intercepted them
		if (this._originalClientMethods && this.target.constructor.name === 'MongoClient') {
			this.target.db = this._originalClientMethods.db;
		}
		
		// Emit close before removing all listeners
		this.emit('close');
		this.removeAllListeners();
	}

	/**
	 * Check if the stream is closed
	 */
	get isClosed() {
		return this.closed;
	}

	/**
	 * Async iterator support for for-await-of loops
	 */
	async *[Symbol.asyncIterator]() {
		const queue = [];
		let resolveNext = null;
		let streamClosed = false;
		
		const onChange = (change) => {
			if (resolveNext) {
				resolveNext({ value: change, done: false });
				resolveNext = null;
			} else {
				queue.push(change);
			}
		};
		
		const onClose = () => {
			streamClosed = true;
			if (resolveNext) {
				resolveNext({ done: true });
				resolveNext = null;
			}
		};
		
		const onError = (error) => {
			if (resolveNext) {
				resolveNext(Promise.reject(error));
				resolveNext = null;
			}
		};
		
		this.on('change', onChange);
		this.on('close', onClose);
		this.on('error', onError);
		
		try {
			while (!streamClosed) {
				if (queue.length > 0) {
					yield queue.shift();
				} else {
					const next = await new Promise((resolve) => {
						resolveNext = resolve;
						// Check if stream was closed while waiting
						if (streamClosed) {
							resolve({ done: true });
						}
					});
					
					if (next.done) break;
					yield next.value;
				}
			}
		} finally {
			this.off('change', onChange);
			this.off('close', onClose);
			this.off('error', onError);
		}
	}

	/**
	 * Get next change (for compatibility)
	 */
	async next() {
		return new Promise((resolve, reject) => {
			const onChange = (change) => {
				cleanup();
				resolve(change);
			};
			
			const onClose = () => {
				cleanup();
				resolve(null);
			};
			
			const onError = (error) => {
				cleanup();
				reject(error);
			};
			
			const cleanup = () => {
				this.off('change', onChange);
				this.off('close', onClose);
				this.off('error', onError);
			};
			
			if (this.closed) {
				resolve(null);
				return;
			}
			
			this.once('change', onChange);
			this.once('close', onClose);
			this.once('error', onError);
		});
	}
}
