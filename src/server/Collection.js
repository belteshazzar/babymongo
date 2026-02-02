import { EventEmitter } from 'events';
import { Cursor } from './Cursor.js';
import { SortedCursor } from './SortedCursor.js';
import { isArray, getProp, applyProjection, copy } from '../utils.js';
import { matches, matchWithArrayIndices } from './queryMatcher.js';
import { applyUpdates, createDocFromUpdate } from './updates.js';
import { RegularCollectionIndex } from './indexes/RegularCollectionIndex.js';
import { TextCollectionIndex } from './indexes/TextCollectionIndex.js';
import { GeospatialIndex } from './indexes/GeospatialIndex.js';
import { QueryPlanner } from './QueryPlanner.js';
import { evaluateExpression } from './aggregationExpressions.js';
import { ChangeStream } from './ChangeStream.js';
import {
  acquireVersionedPath,
  buildVersionedPath,
  createSyncAccessHandle,
  DEFAULT_COMPACTION_MIN_BYTES,
  getCurrentVersion,
  promoteVersion,
  releaseVersionedPath
} from './opfsVersioning.js';
import {
  NotImplementedError,
  QueryError,
  BadValueError,
  IndexError,
  IndexNotFoundError,
  ErrorCodes
} from '../errors.js';
import { ObjectId } from '@belteshazzar/binjson';
import { BPlusTree } from '@belteshazzar/binjson/bplustree';
import { globalTimer } from '../PerformanceTimer.js';

/**
 * Collection class
 */
export class Collection extends EventEmitter {
  constructor(db, name, options = {}) {
    super();
    this.db = db;
    this.name = name;
    this.path = `${this.db.baseFolder}/${this.db.dbName}/${this.name}`
    this.documentsPath = `${this.path}/documents.bj`;
    this.documentsVersionedPath = null;
    this.documentsVersion = 0;
    this._releaseDocuments = null;
    this.order = options.bPlusTreeOrder || 50; // B+ tree order
    this.documents = null; // Initialized in async _initialize()
    this.indexes = new Map(); // Index storage - map of index name to index structure
    this._initialized = false;
    this.isCollection = true; // Flag for ChangeStream to identify collections

    this.queryPlanner = new QueryPlanner(this.indexes); // Query planner
  }

  async _initialize() {
    if (this._initialized) return;

    if (!globalThis.navigator || !globalThis.navigator.storage || typeof globalThis.navigator.storage.getDirectory !== 'function') {
      throw new Error('OPFS not available: navigator.storage.getDirectory is missing');
    }

    const { version, path: versionedPath } = await acquireVersionedPath(this.documentsPath);
    this.documentsVersion = version;
    this.documentsVersionedPath = versionedPath;
    this._releaseDocuments = () => releaseVersionedPath(this.documentsPath, version);

    // Ensure directory exists and get directory handle
    let dirHandle = await this._ensureDirectoryForFile(this.documentsVersionedPath);
    
    // If no directory parts, use root directory
    if (!dirHandle) {
      dirHandle = await globalThis.navigator.storage.getDirectory();
    }
    
    // Get file name from path - safely extract just the filename
    const pathParts = this.documentsVersionedPath.split('/').filter(Boolean);
    const filename = pathParts[pathParts.length - 1];
    
    if (!filename) {
      throw new Error(`Invalid documents path: ${this.documentsVersionedPath}`);
    }
    
    // Get file handle and create sync access handle using native OPFS
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const syncHandle = await fileHandle.createSyncAccessHandle();
    
    this.documents = new BPlusTree(syncHandle, this.order);
    await this.documents.open();

    await this._loadIndexes();

    this._initialized = true;
  }

  async _ensureDirectoryForFile(filePath) {
    if (!filePath) return;
    const pathParts = filePath.split('/').filter(Boolean);
    // Remove filename, keep only directory parts
    pathParts.pop();

    if (pathParts.length === 0) return;

    try {
      let dir = await globalThis.navigator.storage.getDirectory();
      for (const part of pathParts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      return dir; // Return the directory handle
    } catch (error) {
      // Ignore EEXIST - directory already exists
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async _loadIndexes() {
    // Scan the collection folder for persisted index files and recreate them.
    // Supported filenames:
    //   <name>.textindex          -> TextCollectionIndex
    //   <name>.rtree.bj        -> GeospatialIndex
    //   <name>.bplustree.bj    -> RegularCollectionIndex

    // Navigate to the collection directory inside OPFS
    let dirHandle;
    try {
      const parts = this.path.split('/').filter(Boolean);
      let handle = await globalThis.navigator.storage.getDirectory();
      for (const part of parts) {
        handle = await handle.getDirectoryHandle(part, { create: false });
      }
      dirHandle = handle;
    } catch (err) {
      // If the collection folder doesn't exist yet, there is nothing to load
      if (err?.name === 'NotFoundError' || err?.code === 'ENOENT') {
        return;
      }
      throw err;
    }

    for await (const [entryName, entryHandle] of dirHandle.entries()) {
      if (entryHandle.kind !== 'file') continue;

      const versionSuffixPattern = /\.v\d+(?=-|$)/; // Strip ".vN" suffixes before "-" or end of filename.
      const normalizedName = entryName.replace(versionSuffixPattern, '');

      let type;
      if (normalizedName.endsWith('.textindex-documents.bj')) {
        type = 'text';
      } else if (normalizedName.endsWith('.rtree.bj')) {
        type = 'geospatial';
      } else if (normalizedName.endsWith('.bplustree.bj')) {
        type = 'regular';
      } else {
        continue; // Not an index file we understand
      }

      const indexName = normalizedName
        .replace(/\.textindex-documents\.bj$/, '')
        .replace(/\.rtree\.bj$/, '')
        .replace(/\.bplustree\.bj$/, '');

      // Skip if already loaded (avoid duplicates)
      if (this.indexes.has(indexName)) {
        continue;
      }

      const keys = this._parseIndexName(indexName, type);
      if (!keys) {
        // Can't recover keys for custom index names; skip to avoid broken indexes
        continue;
      }

      let index;
      if (type === 'text') {
        const storageFile = await this._getIndexPath(indexName, type);
        index = new TextCollectionIndex(indexName, keys, storageFile, {});
      } else if (type === 'geospatial') {
        const storageFile = await this._getIndexPath(indexName, type);
        index = new GeospatialIndex(indexName, keys, storageFile, {});
      } else {
        const storageFile = await this._getIndexPath(indexName, type);
        index = new RegularCollectionIndex(indexName, keys, storageFile, {});
      }

      try {
        await index.open();
        this.indexes.set(indexName, index);
      } catch (err) {
        // If an index file is corrupted, skip it but don't block collection init
      }
    }
  }

  _parseIndexName(indexName, type) {
    // Reconstruct key spec from default generated index names like "field_1" or "a_1_b_-1".
    const tokens = indexName.split('_');
    if (tokens.length < 2 || tokens.length % 2 !== 0) return null;

    const keys = {};
    for (let i = 0; i < tokens.length; i += 2) {
      const field = tokens[i];
      const dir = tokens[i + 1];

      if (!field || dir === undefined) return null;

      if (type === 'text' || dir === 'text') {
        keys[field] = 'text';
      } else if (type === 'geospatial' || dir === '2dsphere' || dir === '2d') {
        keys[field] = dir === '2d' ? '2d' : '2dsphere';
      } else {
        const num = Number(dir);
        if (Number.isNaN(num) || (num !== 1 && num !== -1)) {
          return null;
        }
        keys[field] = num;
      }
    }
    return keys;
  }


  /**
   * Close all indexes
   */
  async close() {
    if (!this._initialized) return;

    for (const [indexName, index] of this.indexes) {
        await index.close();
    }
    await this._maybeCompactDocuments();
    await this.documents.close();
    if (this._releaseDocuments) {
      await this._releaseDocuments();
      this._releaseDocuments = null;
    }
  }

  async _maybeCompactDocuments() {
    if (!this.documents || !this.documents.file) return;
    const currentVersion = await getCurrentVersion(this.documentsPath);
    if (currentVersion !== this.documentsVersion) return;
    const fileSize = this.documents.file.getFileSize();
    if (!fileSize || fileSize < DEFAULT_COMPACTION_MIN_BYTES) return;

    const nextVersion = currentVersion + 1;
    const compactPath = buildVersionedPath(this.documentsPath, nextVersion);
    const destSyncHandle = await createSyncAccessHandle(compactPath, { reset: true });
    await this.documents.compact(destSyncHandle);
    await promoteVersion(this.documentsPath, nextVersion, currentVersion);
  }

  /**
   * Generate index name from keys
   */
  generateIndexName(keys) {
    const parts = [];
    for (const field in keys) {
      if (keys.hasOwnProperty(field)) {
        parts.push(field + '_' + keys[field]);
      }
    }
    return parts.join('_');
  }

  /**
   * Determine if keys specify a text index
   */
  isTextIndex(keys) {
    for (const field in keys) {
      if (keys[field] === 'text') {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine if keys specify a geospatial index
   */
  isGeospatialIndex(keys) {
    for (const field in keys) {
      if (keys[field] === '2dsphere' || keys[field] === '2d') {
        return true;
      }
    }
    return false;
  }

  async _getIndexPath(indexName, type) {
    // Create index files directly in the collection folder
    const sanitize = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedIndexName = sanitize(indexName);
    
    if (type === 'text') {
      return `${this.path}/${sanitizedIndexName}.textindex`;
    }
    if (type === 'geospatial') {
      return `${this.path}/${sanitizedIndexName}.rtree.bj`;
    }
    // Regular index uses B+ tree
    return `${this.path}/${sanitizedIndexName}.bplustree.bj`;
  }

  /**
   * dist/rebuild an index
   */
  async _buildIndex(indexName, keys, options = {}) {
    if (!this._initialized) await this._initialize();

    let index;
    let storageFile;
    let type;

    // Create appropriate index type
    if (this.isTextIndex(keys)) {
      type = 'text';
      storageFile = await this._getIndexPath(indexName, type);
      index = new TextCollectionIndex(indexName, keys, storageFile, options);
    } else if (this.isGeospatialIndex(keys)) {
      type = 'geospatial';
      storageFile = await this._getIndexPath(indexName, type);
      index = new GeospatialIndex(indexName, keys, storageFile, options);
    } else {
      type = 'regular';
      storageFile = await this._getIndexPath(indexName, type);
      index = new RegularCollectionIndex(indexName, keys, storageFile, options);
    }

    // Open the index for use
    await index.open();

    // Rebuild from a clean slate to avoid stale persisted entries
    if (typeof index.clear === 'function') {
      await index.clear();
    }

    // Build index by scanning all documents from the B+ tree
    for await (const entry of this.documents) {
      if (entry && entry.value) {
        await index.add(entry.value);
      }
    }

    this.indexes.set(indexName, index);
    return index;
  }

  /**
   * Update indexes when a document is inserted
   */
  async updateIndexesOnInsert(doc) {
    const promises = [];
    for (const [indexName, index] of this.indexes) {
      promises.push((async () => {
        await this._ensureIndexOpen(index);
        await index.add(doc);
      })());
    }
    // Wait for all index operations to complete
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Update indexes when a document is deleted
   */
  async updateIndexesOnDelete(doc) {
    const promises = [];
    for (const [indexName, index] of this.indexes) {
      promises.push((async () => {
        await this._ensureIndexOpen(index);
        await index.remove(doc);
      })());
    }
    // Wait for all index operations to complete
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Ensure an index is open before using it
   * @private
   */
  async _ensureIndexOpen(index) {
    if (index && typeof index.open === 'function' && !index.isOpen) {
      await index.open();
    }
  }

  /**
   * Query planner - analyze query and determine optimal execution plan
   */
  planQuery(query) {
    const plan = this.queryPlanner.plan(query);
    // Note: With OPFS storage, indexes are async. Callers should use planQueryAsync
    // For now, we return null docIds to signal full scan
    // Actual async query execution happens via planQueryAsync

    return {
      useIndex: plan.type !== 'full_scan',
      planType: plan.type,
      indexNames: plan.indexes,
      docIds: null, // Force full scan for now - use planQueryAsync for index results
      estimatedCost: plan.estimatedCost,
      indexOnly: plan.indexOnly || false
    };
  }

  /**
   * Async version of query planner - for use with async indexes
   */
  async planQueryAsync(query) {
    const plan = this.queryPlanner.plan(query);
    const docIds = await this.queryPlanner.execute(plan);

    return {
      useIndex: plan.type !== 'full_scan',
      planType: plan.type,
      indexNames: plan.indexes,
      docIds: docIds,
      estimatedCost: plan.estimatedCost,
      indexOnly: plan.indexOnly || false
    };
  }

  /**
   * Get a text index for the given field
   * @param {string} field - The field name
   * @returns {TextCollectionIndex|null} The text index or null if not found
   */
  getTextIndex(field) {
    for (const [indexName, index] of this.indexes) {
      if (index instanceof TextCollectionIndex) {
        // Check if this field is indexed
        if (index.indexedFields.includes(field)) {
          return index;
        }
      }
    }
    return null;
  }

  // Collection methods
  async aggregate(pipeline) {
    const timer = globalTimer.start('collection', 'aggregate', { collection: this.name, stageCount: pipeline?.length || 0 });
    
    if (!pipeline || !isArray(pipeline)) {
      throw new QueryError('Pipeline must be an array', {
        collection: this.name,
        code: ErrorCodes.FAILED_TO_PARSE
      });
    }

    // Start with all documents
    const loadTimer = globalTimer.start('collection', 'aggregate.loadDocuments');
    let results = [];
    const cursor = this.find({});
    await cursor._ensureInitialized();
    // TODO: Optimize by applying $match stages during iteration
    while (await cursor.hasNext()) {
      results.push(await cursor.next());
    }
    globalTimer.end(loadTimer, { docCount: results.length });

    // Process each stage in the pipeline
    for (let i = 0; i < pipeline.length; i++) {
      const stage = pipeline[i];
      const stageKeys = Object.keys(stage);
      if (stageKeys.length !== 1) {
        throw new QueryError('Each pipeline stage must have exactly one key', {
          collection: this.name,
          code: ErrorCodes.FAILED_TO_PARSE
        });
      }
      const stageType = stageKeys[0];
      const stageSpec = stage[stageType];
      
      const stageTimer = globalTimer.start('collection', `aggregate.${stageType}`, { inputDocs: results.length });

      if (stageType === "$match") {
        // Filter documents based on query
        const matched = [];
        for (let j = 0; j < results.length; j++) {
          if (matches(results[j], stageSpec)) {
            matched.push(results[j]);
          }
        }
        results = matched;
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$project") {
        // Reshape documents with expression support
        const projected = [];
        for (let j = 0; j < results.length; j++) {
          projected.push(applyProjectionWithExpressions(stageSpec, results[j]));
        }
        results = projected;
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$addFields" || stageType === "$set") {
        // Add/set fields with computed expressions
        const modified = [];
        for (let j = 0; j < results.length; j++) {
          const doc = copy(results[j]);
          for (const field in stageSpec) {
            const expr = stageSpec[field];
            doc[field] = evaluateExpression(expr, results[j]);
          }
          modified.push(doc);
        }
        results = modified;
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$unset") {
        // Remove fields from documents
        const modified = [];
        // $unset can be a string (single field), array of strings, or object
        let fieldsToRemove = [];
        if (typeof stageSpec === 'string') {
          fieldsToRemove = [stageSpec];
        } else if (Array.isArray(stageSpec)) {
          fieldsToRemove = stageSpec;
        } else if (typeof stageSpec === 'object') {
          // Object form: { field1: "", field2: "" } or { field1: 1, field2: 1 }
          fieldsToRemove = Object.keys(stageSpec);
        }

        for (let j = 0; j < results.length; j++) {
          const doc = copy(results[j]);
          for (let k = 0; k < fieldsToRemove.length; k++) {
            const field = fieldsToRemove[k];
            // Support dot notation for nested field removal
            const pathParts = field.split('.');
            if (pathParts.length === 1) {
              delete doc[field];
            } else {
              // Navigate to parent and delete nested field
              let parent = doc;
              for (let m = 0; m < pathParts.length - 1; m++) {
                if (parent == undefined || parent == null) break;
                parent = parent[pathParts[m]];
              }
              if (parent != undefined && parent != null) {
                delete parent[pathParts[pathParts.length - 1]];
              }
            }
          }
          modified.push(doc);
        }
        results = modified;
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$sort") {
        // Sort documents
        const sortKeys = Object.keys(stageSpec);
        results.sort(function (a, b) {
          for (let k = 0; k < sortKeys.length; k++) {
            const key = sortKeys[k];
            if (a[key] === undefined && b[key] !== undefined) return -1 * stageSpec[key];
            if (a[key] !== undefined && b[key] === undefined) return 1 * stageSpec[key];
            if (a[key] < b[key]) return -1 * stageSpec[key];
            if (a[key] > b[key]) return 1 * stageSpec[key];
          }
          return 0;
        });
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$limit") {
        // Limit number of documents
        results = results.slice(0, stageSpec);
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$skip") {
        // Skip documents
        results = results.slice(stageSpec);
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$group") {
        // Group documents
        const groups = {};
        const groupId = stageSpec._id;

        for (let j = 0; j < results.length; j++) {
          const doc = results[j];
          let key;

          // Compute group key using expression evaluator
          if (groupId === null || groupId === undefined) {
            key = null;
          } else {
            key = evaluateExpression(groupId, doc);
          }

          const keyStr = JSON.stringify(key);

          // Initialize group
          if (!groups[keyStr]) {
            groups[keyStr] = {
              _id: key,
              docs: [],
              accumulators: {}
            };
          }

          groups[keyStr].docs.push(doc);
        }

        // Apply accumulators
        const grouped = [];
        for (const groupKey in groups) {
          const group = groups[groupKey];
          const result = { _id: group._id };

          // Process each accumulator field
          for (const field in stageSpec) {
            if (field === '_id') continue;

            const accumulator = stageSpec[field];
            const accKeys = Object.keys(accumulator);
            if (accKeys.length !== 1) continue;

            const accType = accKeys[0];
            const accExpr = accumulator[accType];

            if (accType === '$sum') {
              let sum = 0;
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                if (typeof val === 'number') {
                  sum += val;
                } else if (val !== null && val !== undefined) {
                  sum += Number(val) || 0;
                }
              }
              result[field] = sum;
            } else if (accType === '$avg') {
              let sum = 0;
              let count = 0;
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                if (val !== undefined && val !== null) {
                  sum += Number(val) || 0;
                  count++;
                }
              }
              result[field] = count > 0 ? sum / count : 0;
            } else if (accType === '$min') {
              let min = undefined;
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                if (val !== undefined && (min === undefined || val < min)) {
                  min = val;
                }
              }
              result[field] = min;
            } else if (accType === '$max') {
              let max = undefined;
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                if (val !== undefined && (max === undefined || val > max)) {
                  max = val;
                }
              }
              result[field] = max;
            } else if (accType === '$push') {
              const arr = [];
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                arr.push(val);
              }
              result[field] = arr;
            } else if (accType === '$addToSet') {
              const set = {};
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                set[JSON.stringify(val)] = val;
              }
              const arr = [];
              for (const valKey in set) {
                arr.push(set[valKey]);
              }
              result[field] = arr;
            } else if (accType === '$first') {
              if (group.docs.length > 0) {
                result[field] = evaluateExpression(accExpr, group.docs[0]);
              }
            } else if (accType === '$last') {
              if (group.docs.length > 0) {
                result[field] = evaluateExpression(accExpr, group.docs[group.docs.length - 1]);
              }
            } else if (accType === '$stdDevPop') {
              // Population standard deviation
              const values = [];
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                if (typeof val === 'number') {
                  values.push(val);
                }
              }
              if (values.length > 0) {
                const mean = values.reduce((a, b) => a + b, 0) / values.length;
                const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
                result[field] = Math.sqrt(variance);
              } else {
                result[field] = 0;
              }
            } else if (accType === '$stdDevSamp') {
              // Sample standard deviation
              const values = [];
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                if (typeof val === 'number') {
                  values.push(val);
                }
              }
              if (values.length > 1) {
                const mean = values.reduce((a, b) => a + b, 0) / values.length;
                const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (values.length - 1);
                result[field] = Math.sqrt(variance);
              } else {
                result[field] = 0;
              }
            } else if (accType === '$mergeObjects') {
              // Merge objects from all documents in group
              const merged = {};
              for (let k = 0; k < group.docs.length; k++) {
                const val = evaluateExpression(accExpr, group.docs[k]);
                if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                  Object.assign(merged, val);
                }
              }
              result[field] = merged;
            }
          }

          grouped.push(result);
        }
        results = grouped;
        globalTimer.end(stageTimer, { outputDocs: results.length, groupCount: Object.keys(groups).length });
      } else if (stageType === "$count") {
        // Count documents and return single document with count
        results = [{ [stageSpec]: results.length }];
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$unwind") {
        // Unwind array field
        const unwound = [];
        let fieldPath = stageSpec;
        if (typeof fieldPath === 'string' && fieldPath.charAt(0) === '$') {
          fieldPath = fieldPath.substring(1);
        }

        for (let j = 0; j < results.length; j++) {
          const doc = results[j];
          const arr = getProp(doc, fieldPath);

          if (arr && isArray(arr) && arr.length > 0) {
            for (let k = 0; k < arr.length; k++) {
              const unwoundDoc = copy(doc);
              // Set the unwound value
              const parts = fieldPath.split('.');
              let target = unwoundDoc;
              for (let l = 0; l < parts.length - 1; l++) {
                if (!target[parts[l]]) {
                  target[parts[l]] = {};
                }
                target = target[parts[l]];
              }
              target[parts[parts.length - 1]] = arr[k];
              unwound.push(unwoundDoc);
            }
          }
          // MongoDB's default behavior: skip documents where field is missing, null, empty array, or not an array
        }
        results = unwound;
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else if (stageType === "$sortByCount") {
        // Group by expression value and count occurrences, sorted descending by count
        const groups = {};

        for (let j = 0; j < results.length; j++) {
          const doc = results[j];
          const value = evaluateExpression(stageSpec, doc);
          const key = JSON.stringify(value);

          if (!groups[key]) {
            groups[key] = {
              _id: value,
              count: 0
            };
          }
          groups[key].count++;
        }

        // Convert to array and sort by count descending
        results = Object.values(groups).sort((a, b) => b.count - a.count);
      } else if (stageType === "$replaceRoot" || stageType === "$replaceWith") {
        // Replace root document with specified document
        const modified = [];
        const newRootSpec = stageType === "$replaceRoot" ? stageSpec.newRoot : stageSpec;

        for (let j = 0; j < results.length; j++) {
          const newRoot = evaluateExpression(newRootSpec, results[j]);
          if (typeof newRoot === 'object' && newRoot !== null && !Array.isArray(newRoot)) {
            modified.push(newRoot);
          } else {
            throw new QueryError('$replaceRoot expression must evaluate to an object', {
              collection: this.name,
              code: ErrorCodes.FAILED_TO_PARSE
            });
          }
        }
        results = modified;
      } else if (stageType === "$sample") {
        // Random sampling of documents
        const size = stageSpec.size || 1;
        if (typeof size !== 'number' || size < 0) {
          throw new QueryError('$sample size must be a non-negative number', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        // Shuffle using Fisher-Yates algorithm and take first 'size' elements
        const shuffled = [...results];
        for (let j = shuffled.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
        }
        results = shuffled.slice(0, Math.min(size, shuffled.length));
      } else if (stageType === "$bucket") {
        // Categorize documents into buckets based on boundaries
        if (!stageSpec.groupBy || !stageSpec.boundaries) {
          throw new QueryError('$bucket requires groupBy and boundaries', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        const boundaries = stageSpec.boundaries;
        const defaultBucket = stageSpec.default;
        const output = stageSpec.output || { count: { $sum: 1 } };

        // Initialize buckets
        const buckets = {};
        for (let j = 0; j < boundaries.length - 1; j++) {
          const key = JSON.stringify(boundaries[j]);
          buckets[key] = {
            _id: boundaries[j],
            docs: []
          };
        }
        if (defaultBucket !== undefined) {
          buckets['default'] = {
            _id: defaultBucket,
            docs: []
          };
        }

        // Categorize documents into buckets
        for (let j = 0; j < results.length; j++) {
          const doc = results[j];
          const value = evaluateExpression(stageSpec.groupBy, doc);

          let placed = false;
          for (let k = 0; k < boundaries.length - 1; k++) {
            if (value >= boundaries[k] && value < boundaries[k + 1]) {
              const key = JSON.stringify(boundaries[k]);
              buckets[key].docs.push(doc);
              placed = true;
              break;
            }
          }

          if (!placed && defaultBucket !== undefined) {
            buckets['default'].docs.push(doc);
          }
        }

        // Apply output accumulators
        const bucketed = [];
        for (const bucketKey in buckets) {
          const bucket = buckets[bucketKey];
          if (bucket.docs.length === 0) continue; // Skip empty buckets

          const result = { _id: bucket._id };

          for (const field in output) {
            const accumulator = output[field];
            const accKeys = Object.keys(accumulator);
            if (accKeys.length !== 1) continue;

            const accType = accKeys[0];
            const accExpr = accumulator[accType];

            // Apply accumulator (reuse $group logic)
            if (accType === '$sum') {
              let sum = 0;
              for (let k = 0; k < bucket.docs.length; k++) {
                const val = evaluateExpression(accExpr, bucket.docs[k]);
                if (typeof val === 'number') {
                  sum += val;
                } else if (val !== null && val !== undefined) {
                  sum += Number(val) || 0;
                }
              }
              result[field] = sum;
            } else if (accType === '$avg') {
              let sum = 0;
              let count = 0;
              for (let k = 0; k < bucket.docs.length; k++) {
                const val = evaluateExpression(accExpr, bucket.docs[k]);
                if (val !== undefined && val !== null) {
                  sum += Number(val) || 0;
                  count++;
                }
              }
              result[field] = count > 0 ? sum / count : 0;
            } else if (accType === '$push') {
              const arr = [];
              for (let k = 0; k < bucket.docs.length; k++) {
                const val = evaluateExpression(accExpr, bucket.docs[k]);
                arr.push(val);
              }
              result[field] = arr;
            } else if (accType === '$addToSet') {
              const set = {};
              for (let k = 0; k < bucket.docs.length; k++) {
                const val = evaluateExpression(accExpr, bucket.docs[k]);
                set[JSON.stringify(val)] = val;
              }
              result[field] = Object.values(set);
            }
          }

          bucketed.push(result);
        }

        // Sort by _id (bucket boundary)
        results = bucketed.sort((a, b) => {
          if (a._id < b._id) return -1;
          if (a._id > b._id) return 1;
          return 0;
        });
      } else if (stageType === "$bucketAuto") {
        // Auto-calculate bucket boundaries and categorize documents
        if (!stageSpec.groupBy || !stageSpec.buckets) {
          throw new QueryError('$bucketAuto requires groupBy and buckets', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        const numBuckets = stageSpec.buckets;
        const output = stageSpec.output || { count: { $sum: 1 } };

        if (results.length === 0) {
          results = [];
        } else {
          // Extract and sort values
          const values = results.map(doc => ({
            value: evaluateExpression(stageSpec.groupBy, doc),
            doc: doc
          })).sort((a, b) => {
            if (a.value < b.value) return -1;
            if (a.value > b.value) return 1;
            return 0;
          });

          // Calculate bucket size
          const bucketSize = Math.ceil(values.length / numBuckets);
          const buckets = [];

          for (let j = 0; j < numBuckets && j * bucketSize < values.length; j++) {
            const startIdx = j * bucketSize;
            const endIdx = Math.min((j + 1) * bucketSize, values.length);
            const bucketDocs = values.slice(startIdx, endIdx);

            if (bucketDocs.length === 0) continue;

            const bucket = {
              _id: {
                min: bucketDocs[0].value,
                max: endIdx < values.length ? bucketDocs[bucketDocs.length - 1].value : bucketDocs[bucketDocs.length - 1].value
              },
              docs: bucketDocs.map(v => v.doc)
            };
            buckets.push(bucket);
          }

          // Apply output accumulators
          const bucketed = [];
          for (let j = 0; j < buckets.length; j++) {
            const bucket = buckets[j];
            const result = { _id: bucket._id };

            for (const field in output) {
              const accumulator = output[field];
              const accKeys = Object.keys(accumulator);
              if (accKeys.length !== 1) continue;

              const accType = accKeys[0];
              const accExpr = accumulator[accType];

              if (accType === '$sum') {
                let sum = 0;
                for (let k = 0; k < bucket.docs.length; k++) {
                  const val = evaluateExpression(accExpr, bucket.docs[k]);
                  if (typeof val === 'number') {
                    sum += val;
                  } else if (val !== null && val !== undefined) {
                    sum += Number(val) || 0;
                  }
                }
                result[field] = sum;
              } else if (accType === '$avg') {
                let sum = 0;
                let count = 0;
                for (let k = 0; k < bucket.docs.length; k++) {
                  const val = evaluateExpression(accExpr, bucket.docs[k]);
                  if (val !== undefined && val !== null) {
                    sum += Number(val) || 0;
                    count++;
                  }
                }
                result[field] = count > 0 ? sum / count : 0;
              } else if (accType === '$push') {
                const arr = [];
                for (let k = 0; k < bucket.docs.length; k++) {
                  const val = evaluateExpression(accExpr, bucket.docs[k]);
                  arr.push(val);
                }
                result[field] = arr;
              }
            }

            bucketed.push(result);
          }

          results = bucketed;
        }
      } else if (stageType === "$out") {
        // Output results to a collection (replaces existing collection)
        const targetCollectionName = stageSpec;

        if (typeof targetCollectionName !== 'string') {
          throw new QueryError('$out requires a string collection name', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        // Drop target collection if it exists
        if (this.db.collections.has(targetCollectionName)) {
          await this.db.dropCollection(targetCollectionName);
        }

        // Access collection via proxy (will auto-create)
        const targetCollection = this.db[targetCollectionName];

        // Insert all results into target collection
        for (let j = 0; j < results.length; j++) {
          const doc = results[j];
          const docId = doc._id;
          const key = (typeof docId === 'object' && docId.toString) ? docId.toString() : String(docId);
          await targetCollection.insertOne(doc);
        }

        // $out returns empty results (MongoDB behavior)
        results = [];
      } else if (stageType === "$merge") {
        // Merge results into a collection (MongoDB 4.2+)
        let targetCollectionName;
        let on = '_id';
        let whenMatched = 'merge';
        let whenNotMatched = 'insert';

        if (typeof stageSpec === 'string') {
          targetCollectionName = stageSpec;
        } else if (typeof stageSpec === 'object') {
          targetCollectionName = stageSpec.into;
          on = stageSpec.on || on;
          whenMatched = stageSpec.whenMatched || whenMatched;
          whenNotMatched = stageSpec.whenNotMatched || whenNotMatched;
        }

        if (!targetCollectionName) {
          throw new QueryError('$merge requires a target collection', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        // Access collection via proxy (will auto-create if needed)
        const targetCollection = this.db[targetCollectionName];

        // Merge documents
        for (let j = 0; j < results.length; j++) {
          const doc = results[j];
          const matchField = typeof on === 'string' ? on : on[0];
          const matchValue = getProp(doc, matchField);

          // Find existing document
          const existingCursor = targetCollection.find({ [matchField]: matchValue });
          await existingCursor._ensureInitialized();
          const existing = await existingCursor.hasNext() ? await existingCursor.next() : null;

          if (existing) {
            if (whenMatched === 'replace') {
              await targetCollection.replaceOne({ _id: existing._id }, doc);
            } else if (whenMatched === 'merge') {
              const merged = Object.assign({}, existing, doc);
              await targetCollection.replaceOne({ _id: existing._id }, merged);
            } else if (whenMatched === 'keepExisting') {
              // Do nothing
            } else if (whenMatched === 'fail') {
              throw new QueryError('$merge failed: duplicate key', {
                collection: this.name,
                code: ErrorCodes.DUPLICATE_KEY
              });
            }
          } else {
            if (whenNotMatched === 'insert') {
              await targetCollection.insertOne(doc);
            } else if (whenNotMatched === 'discard') {
              // Do nothing
            } else if (whenNotMatched === 'fail') {
              throw new QueryError('$merge failed: document not found', {
                collection: this.name,
                code: ErrorCodes.FAILED_TO_PARSE
              });
            }
          }
        }

        // $merge returns empty results (MongoDB behavior)
        results = [];
      } else if (stageType === "$lookup") {
        // Left outer join with another collection
        if (!stageSpec.from || !stageSpec.localField || !stageSpec.foreignField || !stageSpec.as) {
          throw new QueryError('$lookup requires from, localField, foreignField, and as', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        // Check if collection exists without triggering auto-creation
        const collectionNames = await this.db.getCollectionNames();
        if (!collectionNames.includes(stageSpec.from)) {
          throw new QueryError('$lookup: collection not found: ' + stageSpec.from, {
            collection: this.name,
            code: ErrorCodes.NAMESPACE_NOT_FOUND
          });
        }

        const fromCollection = this.db[stageSpec.from];

        const joined = [];
        for (let j = 0; j < results.length; j++) {
          const doc = copy(results[j]);
          const localValue = getProp(doc, stageSpec.localField);

          // Find matching documents in foreign collection
          const matches = [];
          const foreignCursor = fromCollection.find({ [stageSpec.foreignField]: localValue });
          await foreignCursor._ensureInitialized();
          while (await foreignCursor.hasNext()) {
            matches.push(await foreignCursor.next());
          }

          doc[stageSpec.as] = matches;
          joined.push(doc);
        }
        results = joined;
      } else if (stageType === "$graphLookup") {
        // Recursive graph lookup
        if (!stageSpec.from || !stageSpec.startWith || !stageSpec.connectFromField ||
          !stageSpec.connectToField || !stageSpec.as) {
          throw new QueryError('$graphLookup requires from, startWith, connectFromField, connectToField, and as', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        // Check if collection exists without triggering auto-creation
        const collectionNames = await this.db.getCollectionNames();
        if (!collectionNames.includes(stageSpec.from)) {
          throw new QueryError('$graphLookup: collection not found: ' + stageSpec.from, {
            collection: this.name,
            code: ErrorCodes.NAMESPACE_NOT_FOUND
          });
        }

        const fromCollection = this.db[stageSpec.from];

        const maxDepth = stageSpec.maxDepth !== undefined ? stageSpec.maxDepth : Number.MAX_SAFE_INTEGER;
        const depthField = stageSpec.depthField;
        const restrictSearchWithMatch = stageSpec.restrictSearchWithMatch;

        const graphed = [];
        for (let j = 0; j < results.length; j++) {
          const doc = copy(results[j]);
          const startValue = evaluateExpression(stageSpec.startWith, results[j]);

          // Recursive lookup
          const visited = new Set();
          const matches = [];
          const queue = [{ value: startValue, depth: 0 }];

          while (queue.length > 0) {
            const { value, depth } = queue.shift();
            if (depth > maxDepth) continue;

            const valueKey = JSON.stringify(value);
            if (visited.has(valueKey)) continue;
            visited.add(valueKey);

            // Find matching documents
            let query = { [stageSpec.connectToField]: value };
            if (restrictSearchWithMatch) {
              query = { $and: [query, restrictSearchWithMatch] };
            }

            const cursor = fromCollection.find(query);
            await cursor._ensureInitialized();
            while (await cursor.hasNext()) {
              const match = await cursor.next();
              const matchCopy = copy(match);

              if (depthField) {
                matchCopy[depthField] = depth;
              }

              matches.push(matchCopy);

              // Add connected value to queue for next iteration
              const nextValue = getProp(match, stageSpec.connectFromField);
              if (nextValue !== undefined && nextValue !== null) {
                queue.push({ value: nextValue, depth: depth + 1 });
              }
            }
          }

          doc[stageSpec.as] = matches;
          graphed.push(doc);
        }
        results = graphed;
      } else if (stageType === "$facet") {
        // Multiple parallel pipelines
        if (typeof stageSpec !== 'object' || Array.isArray(stageSpec)) {
          throw new QueryError('$facet requires an object with pipeline definitions', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        const facetResult = {};

        for (const facetName in stageSpec) {
          const facetPipeline = stageSpec[facetName];

          if (!Array.isArray(facetPipeline)) {
            throw new QueryError('$facet pipeline must be an array', {
              collection: this.name,
              code: ErrorCodes.FAILED_TO_PARSE
            });
          }

          // Execute the sub-pipeline on a copy of current results
          let facetResults = results.map(r => copy(r));

          for (let k = 0; k < facetPipeline.length; k++) {
            const facetStage = facetPipeline[k];
            const facetStageKeys = Object.keys(facetStage);
            if (facetStageKeys.length !== 1) {
              throw new QueryError('Each pipeline stage must have exactly one key', {
                collection: this.name,
                code: ErrorCodes.FAILED_TO_PARSE
              });
            }

            const facetStageType = facetStageKeys[0];
            const facetStageSpec = facetStage[facetStageType];

            // Process facet stage (recursive call to aggregation logic)
            // We need to inline the stage processing here
            if (facetStageType === "$match") {
              const matched = [];
              for (let m = 0; m < facetResults.length; m++) {
                if (matches(facetResults[m], facetStageSpec)) {
                  matched.push(facetResults[m]);
                }
              }
              facetResults = matched;
            } else if (facetStageType === "$project") {
              const projected = [];
              for (let m = 0; m < facetResults.length; m++) {
                projected.push(applyProjectionWithExpressions(facetStageSpec, facetResults[m]));
              }
              facetResults = projected;
            } else if (facetStageType === "$limit") {
              facetResults = facetResults.slice(0, facetStageSpec);
            } else if (facetStageType === "$skip") {
              facetResults = facetResults.slice(facetStageSpec);
            } else if (facetStageType === "$sort") {
              const sortKeys = Object.keys(facetStageSpec);
              facetResults.sort(function (a, b) {
                for (let n = 0; n < sortKeys.length; n++) {
                  const key = sortKeys[n];
                  if (a[key] === undefined && b[key] !== undefined) return -1 * facetStageSpec[key];
                  if (a[key] !== undefined && b[key] === undefined) return 1 * facetStageSpec[key];
                  if (a[key] < b[key]) return -1 * facetStageSpec[key];
                  if (a[key] > b[key]) return 1 * facetStageSpec[key];
                }
                return 0;
              });
            } else if (facetStageType === "$count") {
              facetResults = [{ [facetStageSpec]: facetResults.length }];
            } else if (facetStageType === "$group") {
              // Handle $group in facet sub-pipelines
              const groups = {};
              const groupId = facetStageSpec._id;

              for (let m = 0; m < facetResults.length; m++) {
                const doc = facetResults[m];
                let key;

                if (groupId === null || groupId === undefined) {
                  key = null;
                } else {
                  key = evaluateExpression(groupId, doc);
                }

                const keyStr = JSON.stringify(key);

                if (!groups[keyStr]) {
                  groups[keyStr] = {
                    _id: key,
                    docs: [],
                    accumulators: {}
                  };
                }

                groups[keyStr].docs.push(doc);
              }

              // Apply accumulators (simplified version)
              const grouped = [];
              for (const groupKey in groups) {
                const group = groups[groupKey];
                const result = { _id: group._id };

                for (const field in facetStageSpec) {
                  if (field === '_id') continue;

                  const accumulator = facetStageSpec[field];
                  const accKeys = Object.keys(accumulator);
                  if (accKeys.length !== 1) continue;

                  const accType = accKeys[0];
                  const accExpr = accumulator[accType];

                  if (accType === '$sum') {
                    let sum = 0;
                    for (let n = 0; n < group.docs.length; n++) {
                      const val = evaluateExpression(accExpr, group.docs[n]);
                      if (typeof val === 'number') {
                        sum += val;
                      } else if (val !== null && val !== undefined) {
                        sum += Number(val) || 0;
                      }
                    }
                    result[field] = sum;
                  } else if (accType === '$avg') {
                    let sum = 0;
                    let count = 0;
                    for (let n = 0; n < group.docs.length; n++) {
                      const val = evaluateExpression(accExpr, group.docs[n]);
                      if (val !== undefined && val !== null) {
                        sum += Number(val) || 0;
                        count++;
                      }
                    }
                    result[field] = count > 0 ? sum / count : 0;
                  } else if (accType === '$max') {
                    let max = undefined;
                    for (let n = 0; n < group.docs.length; n++) {
                      const val = evaluateExpression(accExpr, group.docs[n]);
                      if (val !== undefined && (max === undefined || val > max)) {
                        max = val;
                      }
                    }
                    result[field] = max;
                  }
                }

                grouped.push(result);
              }
              facetResults = grouped;
            } else if (facetStageType === "$sortByCount") {
              // Handle $sortByCount in facet sub-pipelines
              const groups = {};

              for (let m = 0; m < facetResults.length; m++) {
                const doc = facetResults[m];
                const value = evaluateExpression(facetStageSpec, doc);
                const key = JSON.stringify(value);

                if (!groups[key]) {
                  groups[key] = {
                    _id: value,
                    count: 0
                  };
                }
                groups[key].count++;
              }

              facetResults = Object.values(groups).sort((a, b) => b.count - a.count);
            } else if (facetStageType === "$sample") {
              // Handle $sample in facet sub-pipelines
              const size = facetStageSpec.size || 1;
              const shuffled = [...facetResults];
              for (let m = shuffled.length - 1; m > 0; m--) {
                const k = Math.floor(Math.random() * (m + 1));
                [shuffled[m], shuffled[k]] = [shuffled[k], shuffled[m]];
              }
              facetResults = shuffled.slice(0, Math.min(size, shuffled.length));
            } else if (facetStageType === "$bucket") {
              // Handle $bucket in facet sub-pipelines
              const boundaries = facetStageSpec.boundaries;
              const defaultBucket = facetStageSpec.default;
              const output = facetStageSpec.output || { count: { $sum: 1 } };

              const buckets = {};
              for (let m = 0; m < boundaries.length - 1; m++) {
                const key = JSON.stringify(boundaries[m]);
                buckets[key] = {
                  _id: boundaries[m],
                  docs: []
                };
              }
              if (defaultBucket !== undefined) {
                buckets['default'] = {
                  _id: defaultBucket,
                  docs: []
                };
              }

              // Categorize documents
              for (let m = 0; m < facetResults.length; m++) {
                const doc = facetResults[m];
                const value = evaluateExpression(facetStageSpec.groupBy, doc);

                let placed = false;
                for (let n = 0; n < boundaries.length - 1; n++) {
                  if (value >= boundaries[n] && value < boundaries[n + 1]) {
                    const key = JSON.stringify(boundaries[n]);
                    buckets[key].docs.push(doc);
                    placed = true;
                    break;
                  }
                }

                if (!placed && defaultBucket !== undefined) {
                  buckets['default'].docs.push(doc);
                }
              }

              // Apply accumulators
              const bucketed = [];
              for (const bucketKey in buckets) {
                const bucket = buckets[bucketKey];
                if (bucket.docs.length === 0) continue;

                const result = { _id: bucket._id };

                for (const field in output) {
                  const accumulator = output[field];
                  const accKeys = Object.keys(accumulator);
                  if (accKeys.length !== 1) continue;

                  const accType = accKeys[0];
                  const accExpr = accumulator[accType];

                  if (accType === '$sum') {
                    let sum = 0;
                    for (let n = 0; n < bucket.docs.length; n++) {
                      const val = evaluateExpression(accExpr, bucket.docs[n]);
                      if (typeof val === 'number') {
                        sum += val;
                      } else if (val !== null && val !== undefined) {
                        sum += Number(val) || 0;
                      }
                    }
                    result[field] = sum;
                  }
                }

                bucketed.push(result);
              }

              facetResults = bucketed.sort((a, b) => {
                if (a._id < b._id) return -1;
                if (a._id > b._id) return 1;
                return 0;
              });
            }
            // Add more stage types as needed for facet sub-pipelines
          }

          facetResult[facetName] = facetResults;
        }

        results = [facetResult];
      } else if (stageType === "$redact") {
        // Conditionally filter or redact document content
        const redacted = [];

        for (let j = 0; j < results.length; j++) {
          const doc = results[j];
          const decision = evaluateExpression(stageSpec, doc);

          if (decision === '$$DESCEND') {
            // Include document and recurse into subdocuments (simplified: just include)
            redacted.push(doc);
          } else if (decision === '$$PRUNE') {
            // Exclude this document
            continue;
          } else if (decision === '$$KEEP') {
            // Include this document
            redacted.push(doc);
          } else {
            // If result is a conditional expression, evaluate it
            if (decision) {
              redacted.push(doc);
            }
          }
        }
        results = redacted;
      } else if (stageType === "$geoNear") {
        // Geospatial aggregation with distance calculation
        if (!stageSpec.near || !stageSpec.distanceField) {
          throw new QueryError('$geoNear requires near and distanceField', {
            collection: this.name,
            code: ErrorCodes.FAILED_TO_PARSE
          });
        }

        const near = stageSpec.near;
        const distanceField = stageSpec.distanceField;
        const maxDistance = stageSpec.maxDistance;
        const minDistance = stageSpec.minDistance || 0;
        const spherical = stageSpec.spherical !== false;
        const key = stageSpec.key || 'location';

        // Calculate distance for each document
        const withDistances = [];
        for (let j = 0; j < results.length; j++) {
          const doc = copy(results[j]);
          const location = getProp(doc, key);

          if (!location || !Array.isArray(location) || location.length < 2) {
            continue;
          }

          // Calculate distance (using Haversine formula for spherical or Euclidean for planar)
          let distance;
          if (spherical) {
            // Haversine formula for great circle distance
            const R = 6371000; // Earth radius in meters
            const lat1 = near[1] * Math.PI / 180;
            const lat2 = location[1] * Math.PI / 180;
            const deltaLat = (location[1] - near[1]) * Math.PI / 180;
            const deltaLon = (location[0] - near[0]) * Math.PI / 180;

            const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distance = R * c;
          } else {
            // Euclidean distance
            const dx = location[0] - near[0];
            const dy = location[1] - near[1];
            distance = Math.sqrt(dx * dx + dy * dy);
          }

          // Filter by distance
          if (distance >= minDistance && (!maxDistance || distance <= maxDistance)) {
            doc[distanceField] = distance;
            withDistances.push(doc);
          }
        }

        // Sort by distance (nearest first)
        withDistances.sort((a, b) => a[distanceField] - b[distanceField]);

        // Apply limit if specified
        if (stageSpec.limit) {
          results = withDistances.slice(0, stageSpec.limit);
        } else {
          results = withDistances;
        }
        
        globalTimer.end(stageTimer, { outputDocs: results.length });
      } else {
        globalTimer.end(stageTimer, { error: true, stageType });
        throw new QueryError('Unsupported aggregation stage: ' + stageType, {
          collection: this.name,
          code: ErrorCodes.FAILED_TO_PARSE
        });
      }
    }

    globalTimer.end(timer, { resultCount: results.length });
    return results;
  }

  async bulkWrite() { throw new NotImplementedError('bulkWrite', { collection: this.name }); }

  async count() {
    if (!this._initialized) await this._initialize();

    let count = 0;
    for await (const _ of this.documents) {
      count++;
    }
    return count;
  }

  async copyTo(destCollectionName) {
    // Create the destination collection explicitly to ensure it's registered
    this.db.createCollection(destCollectionName);
    const destCol = this.db.getCollection(destCollectionName);
    let numCopied = 0;
    const c = this.find({});
    await c._ensureInitialized();
    while (await c.hasNext()) {
      await destCol.insertOne(await c.next());
      numCopied++;
    }

    return numCopied;
  }

  async createIndex(keys, options) {
    if (!this._initialized) await this._initialize();

    // MongoDB-compliant createIndex
    // keys: { fieldName: 1 } for ascending, { fieldName: -1 } for descending, { fieldName: 'text' } for text
    // options: { name: "indexName", unique: true, ... }

    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
      throw new BadValueError('keys', keys, 'createIndex requires a key specification object', {
        collection: this.name
      });
    }

    const indexName = (options && options.name) ? options.name : this.generateIndexName(keys);

    // Check if index already exists
    if (this.indexes.has(indexName)) {
      // MongoDB checks for key specification conflicts
      const existingIndex = this.indexes.get(indexName);
      const existingKeys = JSON.stringify(existingIndex.keys);
      const newKeys = JSON.stringify(keys);
      if (existingKeys !== newKeys) {
        throw new IndexError(
          "Index with name '" + indexName + "' already exists with a different key specification",
          {
            code: ErrorCodes.INDEX_OPTIONS_CONFLICT,
            index: indexName,
            collection: this.name
          }
        );
      }
      // Same index, return without error
      return indexName;
    }

    // Build the index
    await this._buildIndex(indexName, keys, options);

    return indexName;
  }

  dataSize() { throw new NotImplementedError('dataSize', { collection: this.name }); }

  async deleteOne(query) {
    const doc = await this.findOne(query);
    if (doc) {
      await this.updateIndexesOnDelete(doc);
      await this.documents.delete(doc._id.toString());
      this.emit('delete', { _id: doc._id });
      return { deletedCount: 1 };
    } else {
      return { deletedCount: 0 };
    }
  }

  async deleteMany(query) {
    const c = this.find(query);
    await c._ensureInitialized();
    const ids = [];
    const docs = [];
    while (await c.hasNext()) {
      const doc = await c.next();
      ids.push(doc._id);
      docs.push(doc);
    }
    const deletedCount = ids.length;
    for (let i = 0; i < ids.length; i++) {
      await this.updateIndexesOnDelete(docs[i]);
      this.documents.delete(ids[i].toString());
      this.emit('delete', { _id: ids[i] });
    }
    return { deletedCount: deletedCount };
  }

  async distinct(field, query) {
    const vals = {};
    const c = this.find(query);
    await c._ensureInitialized();
    while (await c.hasNext()) {
      const d = await c.next();
      if (d[field]) {
        vals[d[field]] = true;
      }
    }
    return Object.keys(vals);
  }

  async drop() {
    if (!this._initialized) await this._initialize();

    // Close all indexes first
    for (const [indexName, index] of this.indexes) {
      if (index && typeof index.close === 'function') {
        await index.close();
      }
    }

    // Close the documents B+ tree
    if (this.documents && typeof this.documents.close === 'function') {
      await this.documents.close();
    }
    if (this._releaseDocuments) {
      await this._releaseDocuments();
      this._releaseDocuments = null;
    }

    // Explicitly delete all files in the collection directory before removing it
    // This ensures proper cleanup in OPFS environments
    try {
      const pathParts = this.path.split('/').filter(Boolean);
      let collectionDir = await globalThis.navigator.storage.getDirectory();
      
      // Navigate to collection directory
      for (const part of pathParts) {
        collectionDir = await collectionDir.getDirectoryHandle(part, { create: false });
      }

      // Delete all files in the directory
      const entriesToDelete = [];
      for await (const [entryName, entryHandle] of collectionDir.entries()) {
        entriesToDelete.push(entryName);
      }
      
      for (const entryName of entriesToDelete) {
        try {
          await collectionDir.removeEntry(entryName, { recursive: false });
        } catch (e) {
          // Continue deleting other files even if one fails
        }
      }
    } catch (error) {
      // Directory might not exist yet if collection was never initialized
    }

    // Now remove the collection directory itself
    const pathParts = this.path.split('/').filter(Boolean);
    const filename = pathParts.pop();

    try {
      let dir = await globalThis.navigator.storage.getDirectory();
      for (const part of pathParts) {
        dir = await dir.getDirectoryHandle(part, { create: false });
      }
      // Try recursive removal first
      try {
        await dir.removeEntry(filename, { recursive: true });
      } catch (e) {
        // If recursive not supported, try non-recursive (should work now that directory is empty)
        if (e.name === 'TypeError' || e.message?.includes('recursive')) {
          await dir.removeEntry(filename);
        } else {
          throw e;
        }
      }
    } catch (error) {
      // Directory might not exist yet if collection was never initialized
      if (error.name !== 'NotFoundError' && error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Clear state
    this.documents = null;
    this.indexes.clear();
    this._initialized = false;

    // remove from db's collection list
    this.db.collections.delete(this.name);

    this.emit('drop', { collection: this.name });
    return { ok: 1 };
  }

  async dropIndex(indexName) {
    if (!this.indexes.has(indexName)) {
      throw new IndexNotFoundError(indexName, { collection: this.name });
    }

    const index = this.indexes.get(indexName);
    if (index && typeof index.clear === 'function') {
      await index.clear();
    }
    if (index && typeof index.close === 'function') {
      await index.close();
    }

    this.indexes.delete(indexName);
    return { nIndexesWas: this.indexes.size + 1, ok: 1 };
  }

  async dropIndexes() {
    const count = this.indexes.size;
    for (const [_, index] of this.indexes) {
      if (index && typeof index.clear === 'function') {
        await index.clear();
      }
      if (index && typeof index.close === 'function') {
        await index.close();
      }
    }
    this.indexes.clear();
    return { nIndexesWas: count, msg: "non-_id indexes dropped", ok: 1 };
  }
  ensureIndex() { throw new NotImplementedError('ensureIndex', { collection: this.name }); }
  explain() { throw new NotImplementedError('explain', { collection: this.name }); }

  find(query, projection) {
    this._validateProjection(projection);
    // Return cursor immediately with promise for documents
    const documentsPromise = this._findInternal(query, projection);
    return new Cursor(
      this,
      query,
      projection,
      documentsPromise,
      SortedCursor
    );
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

  async _findInternal(query, projection) {
    const timer = globalTimer.start('collection', 'find', { collection: this.name });
    
    if (!this._initialized) await this._initialize();

    const normalizedQuery = query == undefined ? {} : query;
    const nearSpec = this._extractNearSpec(normalizedQuery);

    const documents = [];
    const seen = {}; // Track which docs we've seen to avoid duplicates

    // Try to use indexes if available
    if (this.indexes.size > 0) {
      const planTimer = globalTimer.start('collection', 'find.queryPlanning');
      const queryPlan = await this.planQueryAsync(normalizedQuery);
      globalTimer.end(planTimer, { useIndex: queryPlan.useIndex, docIdsCount: queryPlan.docIds?.length || 0 });
      
      if (queryPlan.useIndex && queryPlan.docIds && queryPlan.docIds.length > 0) {
        // Use index results
        const indexLookupTimer = globalTimer.start('collection', 'find.indexLookup');
        for (const docId of queryPlan.docIds) {
          if (!seen[docId]) {
            const doc = await this.documents.search(docId);
            // Always verify match - index may return candidates or query may have
            // additional conditions not covered by the index
            if (doc && matches(doc, normalizedQuery)) {
              seen[docId] = true;
              documents.push(doc);
            }
          }
        }
        globalTimer.end(indexLookupTimer, { docsFound: documents.length });
      } else {
        // Fall back to full scan if index couldn't be used or returned no results
        const fullScanTimer = globalTimer.start('collection', 'find.fullScan');
        for await (const entry of this.documents) {
          if (entry && entry.value && !seen[entry.value._id] && matches(entry.value, normalizedQuery)) {
            seen[entry.value._id] = true;
            documents.push(entry.value);
          }
        }
        globalTimer.end(fullScanTimer, { docsFound: documents.length });
      }
    } else {
      // No indexes available, do full scan
      const fullScanTimer = globalTimer.start('collection', 'find.fullScan');
      for await (const entry of this.documents) {
        if (entry && entry.value && !seen[entry.value._id] && matches(entry.value, normalizedQuery)) {
          seen[entry.value._id] = true;
          documents.push(entry.value);
        }
      }
      globalTimer.end(fullScanTimer, { docsFound: documents.length });
    }

    // Apply $near sorting if applicable
    if (nearSpec) {
      const sortTimer = globalTimer.start('collection', 'find.nearSort');
      this._sortByNearDistance(documents, nearSpec);
      globalTimer.end(sortTimer);
    }

    // Apply projection if provided
    const projectionTimer = globalTimer.start('collection', 'find.projection');
    const result = documents.map(doc => projection ? applyProjection(projection, copy(doc)) : copy(doc));
    globalTimer.end(projectionTimer, { docsProcessed: result.length });

    globalTimer.end(timer, { docsReturned: result.length, hasIndexes: this.indexes.size > 0 });
    
    // Return projected/copied documents
    return result;
  }

  _extractNearSpec(query) {
    for (const field of Object.keys(query || {})) {
      if (field.startsWith('$')) continue;
      const value = query[field];
      if (!value || typeof value !== 'object') continue;

      if (value.$near) {
        const coords = this._parseNearCoordinates(value.$near);
        if (coords) return { field, ...coords };
      }

      if (value.$nearSphere) {
        const coords = this._parseNearCoordinates(value.$nearSphere);
        if (coords) return { field, ...coords };
      }
    }
    return null;
  }

  _parseNearCoordinates(spec) {
    let coordinates;
    if (spec && typeof spec === 'object') {
      if (spec.$geometry && spec.$geometry.coordinates) {
        coordinates = spec.$geometry.coordinates;
      } else if (spec.coordinates) {
        coordinates = spec.coordinates;
      } else if (Array.isArray(spec)) {
        coordinates = spec;
      }
    }

    if (!coordinates || coordinates.length < 2) {
      return null;
    }

    const [lng, lat] = coordinates;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return null;
    }

    return { lat, lng };
  }

  _extractPointCoordinates(value) {
    if (!value) return null;

    // Handle GeoJSON FeatureCollection
    if (value.type === 'FeatureCollection' && Array.isArray(value.features) && value.features.length > 0) {
      return this._extractPointCoordinates(value.features[0].geometry);
    }

    // Handle GeoJSON Feature
    if (value.type === 'Feature' && value.geometry) {
      return this._extractPointCoordinates(value.geometry);
    }

    // Handle GeoJSON Point
    if (value.type === 'Point' && Array.isArray(value.coordinates) && value.coordinates.length >= 2) {
      const [lng, lat] = value.coordinates;
      if (typeof lat === 'number' && typeof lng === 'number') {
        return { lat, lng };
      }
    }

    return null;
  }

  _sortByNearDistance(documents, nearSpec) {
    const { field, lat: targetLat, lng: targetLng } = nearSpec;
    documents.sort((a, b) => {
      const aPoint = this._extractPointCoordinates(getProp(a, field));
      const bPoint = this._extractPointCoordinates(getProp(b, field));

      const aDist = aPoint ? this._haversineDistance(aPoint.lat, aPoint.lng, targetLat, targetLng) : Infinity;
      const bDist = bPoint ? this._haversineDistance(bPoint.lat, bPoint.lng, targetLat, targetLng) : Infinity;

      return aDist - bDist;
    });
  }

  _haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  findAndModify() { throw new NotImplementedError('findAndModify', { collection: this.name }); }

  async findOne(query, projection) {
    const cursor = this.find(query, projection);
    await cursor._ensureInitialized();
    if (await cursor.hasNext()) {
      return await cursor.next();
    } else {
      return null;
    }
  }

  async findOneAndDelete(filter, options) {
    let c = this.find(filter);
    if (options && options.sort) {
      c = c.sort(options.sort);
      await c._ensureInitialized();
    } else {
      await c._ensureInitialized();
    }
    if (!await c.hasNext()) return null;
    const doc = await c.next();
    await this.documents.delete(doc._id.toString());
    if (options && options.projection) return applyProjection(options.projection, doc);
    else return doc;
  }

  async findOneAndReplace(filter, replacement, options) {
    let c = this.find(filter);
    if (options && options.sort) {
      c = c.sort(options.sort);
      await c._ensureInitialized();
    } else {
      await c._ensureInitialized();
    }
    if (!await c.hasNext()) return null;
    const doc = await c.next();
    replacement._id = doc._id;
    await this.documents.add(doc._id.toString(), replacement);
    if (options && options.returnNewDocument) {
      if (options && options.projection) return applyProjection(options.projection, replacement);
      else return replacement;
    } else {
      if (options && options.projection) return applyProjection(options.projection, doc);
      else return doc;
    }
  }

  async findOneAndUpdate(filter, update, options) {
    let c = this.find(filter);
    if (options && options.sort) {
      c = c.sort(options.sort);
      await c._ensureInitialized();
    } else {
      await c._ensureInitialized();
    }
    if (!await c.hasNext()) return null;
    const doc = await c.next();
    const clone = Object.assign({}, doc);

    // Get array filter information for positional operator support
    const matchInfo = matchWithArrayIndices(doc, filter);
    const positionalMatchInfo = matchInfo.arrayFilters;
    const userArrayFilters = options && options.arrayFilters;

    applyUpdates(update, clone, false, positionalMatchInfo, userArrayFilters);
    await this.documents.add(doc._id.toString(), clone);
    if (options && options.returnNewDocument) {
      if (options && options.projection) return applyProjection(options.projection, clone);
      else return clone;
    } else {
      if (options && options.projection) return applyProjection(options.projection, doc);
      else return doc;
    }
  }

  getIndexes() {
    // Return array of index specifications
    const result = [];
    for (const [indexName, index] of this.indexes) {
      result.push(index.getSpec());
    }
    return result;
  }

  getShardDistribution() { throw new NotImplementedError('getShardDistribution', { collection: this.name }); }
  getShardVersion() { throw new NotImplementedError('getShardVersion', { collection: this.name }); }

  // non-mongo
  getStore() {
    return this.documents;
  }

  group() { throw new NotImplementedError('group', { collection: this.name }); }

  async insert(doc) {
    if (Array == doc.constructor) {
      return await this.insertMany(doc);
    } else {
      return await this.insertOne(doc);
    }
  }

  async insertOne(doc) {
    const timer = globalTimer.start('collection', 'insertOne', { collection: this.name });
    
    if (!this._initialized) await this._initialize();

    if (doc._id == undefined) doc._id = new ObjectId();
    
    const storeTimer = globalTimer.start('collection', 'insertOne.store');
    await this.documents.add(doc._id.toString(), doc);
    globalTimer.end(storeTimer);
    
    const indexTimer = globalTimer.start('collection', 'insertOne.updateIndexes');
    await this.updateIndexesOnInsert(doc);
    globalTimer.end(indexTimer, { indexCount: this.indexes.size });
    
    this.emit('insert', doc);
    
    globalTimer.end(timer);
    return { insertedId: doc._id };
  }

  async insertMany(docs) {
    const timer = globalTimer.start('collection', 'insertMany', { collection: this.name, docCount: docs.length });
    
    if (!this._initialized) await this._initialize();

    const insertedIds = [];
    for (let i = 0; i < docs.length; i++) {
      const result = await this.insertOne(docs[i]);
      insertedIds.push(result.insertedId);
    }
    
    globalTimer.end(timer, { insertedCount: insertedIds.length });
    return { insertedIds: insertedIds };
  }

  isCapped() { throw new NotImplementedError('isCapped', { collection: this.name }); }
  mapReduce() { throw new NotImplementedError('mapReduce', { collection: this.name }); }
  reIndex() { throw new NotImplementedError('reIndex', { collection: this.name }); }

  async replaceOne(query, replacement, options) { // only replace
    // first
    const result = {};
    const c = this.find(query);
    await c._ensureInitialized();
    result.matchedCount = await c.count();
    if (result.matchedCount == 0) {
      result.modifiedCount = 0;
      if (options && options.upsert) {
        const newDoc = replacement;
        newDoc._id = new ObjectId();
        await this.documents.add(newDoc._id.toString(), newDoc);
        await this.updateIndexesOnInsert(newDoc);
        this.emit('insert', newDoc);
        result.upsertedId = newDoc._id;
      }
    } else {
      result.modifiedCount = 1;
      const doc = await c.next();
      await this.updateIndexesOnDelete(doc);
      replacement._id = doc._id;
      this.documents.add(doc._id.toString(), replacement);
      await this.updateIndexesOnInsert(replacement);
      this.emit('replace', replacement);
    }
    return result;
  }

  async remove(query, options) {
    const c = this.find(query);
    await c._ensureInitialized();
    if (!await c.hasNext()) return;
    if (options === true || (options && options.justOne)) {
      const doc = await c.next();
      await this.updateIndexesOnDelete(doc);
      this.documents.delete(doc._id.toString());
    } else {
      while (await c.hasNext()) {
        const doc = await c.next();
        await this.updateIndexesOnDelete(doc);
        this.documents.delete(doc._id.toString());
      }
    }
  }

  renameCollection() { throw new NotImplementedError('renameCollection', { collection: this.name }); }
  save() { throw new NotImplementedError('save', { collection: this.name }); }
  stats() { throw new NotImplementedError('stats', { collection: this.name }); }
  storageSize() { throw new NotImplementedError('storageSize', { collection: this.name }); }
  totalSize() { throw new NotImplementedError('totalSize', { collection: this.name }); }
  totalIndexSize() { throw new NotImplementedError('totalIndexSize', { collection: this.name }); }

  async update(query, updates, options) {
    const c = this.find(query);
    await c._ensureInitialized();
    if (await c.hasNext()) {
      if (options && options.multi) {
        while (await c.hasNext()) {
          const doc = await c.next();

          // Get array filter information for positional operator support
          const matchInfo = matchWithArrayIndices(doc, query);
          const positionalMatchInfo = matchInfo.arrayFilters;
          const userArrayFilters = options && options.arrayFilters;

          await this.updateIndexesOnDelete(doc);
          applyUpdates(updates, doc, false, positionalMatchInfo, userArrayFilters);
          await this.documents.add(doc._id.toString(), doc);
          await this.updateIndexesOnInsert(doc);
        }
      } else {
        const doc = await c.next();

        // Get array filter information for positional operator support
        const matchInfo = matchWithArrayIndices(doc, query);
        const positionalMatchInfo = matchInfo.arrayFilters;
        const userArrayFilters = options && options.arrayFilters;

        await this.updateIndexesOnDelete(doc);
        applyUpdates(updates, doc, false, positionalMatchInfo, userArrayFilters);
        await this.documents.add(doc._id.toString(), doc);
        await this.updateIndexesOnInsert(doc);
      }
    } else {
      if (options && options.upsert) {
        const newDoc = createDocFromUpdate(query, updates, new ObjectId());
        await this.documents.add(newDoc._id.toString(), newDoc);
        await this.updateIndexesOnInsert(newDoc);
      }
    }
  }

  async updateOne(query, updates, options) {
    const timer = globalTimer.start('collection', 'updateOne', { collection: this.name });
    
    const findTimer = globalTimer.start('collection', 'updateOne.find');
    const c = this.find(query);
    await c._ensureInitialized();
    globalTimer.end(findTimer);
    
    if (await c.hasNext()) {
      const doc = await c.next();
      const originalDoc = JSON.parse(JSON.stringify(doc));

      // Get array filter information for positional operator support
      const matchInfo = matchWithArrayIndices(doc, query);
      const positionalMatchInfo = matchInfo.arrayFilters;
      const userArrayFilters = options && options.arrayFilters;

      const indexDelTimer = globalTimer.start('collection', 'updateOne.updateIndexesOnDelete');
      await this.updateIndexesOnDelete(doc);
      globalTimer.end(indexDelTimer);
      
      const applyTimer = globalTimer.start('collection', 'updateOne.applyUpdates');
      applyUpdates(updates, doc, false, positionalMatchInfo, userArrayFilters);
      globalTimer.end(applyTimer);
      
      const storeTimer = globalTimer.start('collection', 'updateOne.store');
      this.documents.add(doc._id.toString(), doc);
      globalTimer.end(storeTimer);
      
      const indexInsTimer = globalTimer.start('collection', 'updateOne.updateIndexesOnInsert');
      await this.updateIndexesOnInsert(doc);
      globalTimer.end(indexInsTimer, { indexCount: this.indexes.size });
      
      const updateDescription = this._getUpdateDescription(originalDoc, doc);
      this.emit('update', doc, updateDescription);
    } else {
      if (options && options.upsert) {
        const newDoc = createDocFromUpdate(query, updates, new ObjectId());
        this.documents.add(newDoc._id.toString(), newDoc);
        await this.updateIndexesOnInsert(newDoc);
        this.emit('insert', newDoc);
      }
    }
    
    globalTimer.end(timer);
  }

  async updateMany(query, updates, options) {
    const timer = globalTimer.start('collection', 'updateMany', { collection: this.name });
    
    const findTimer = globalTimer.start('collection', 'updateMany.find');
    const c = this.find(query);
    await c._ensureInitialized();
    globalTimer.end(findTimer);
    
    let updateCount = 0;
    if (await c.hasNext()) {
      while (await c.hasNext()) {
        const doc = await c.next();
        const originalDoc = JSON.parse(JSON.stringify(doc));

        // Get array filter information for positional operator support
        const matchInfo = matchWithArrayIndices(doc, query);
        const positionalMatchInfo = matchInfo.arrayFilters;
        const userArrayFilters = options && options.arrayFilters;

        await this.updateIndexesOnDelete(doc);
        applyUpdates(updates, doc, false, positionalMatchInfo, userArrayFilters);
        this.documents.add(doc._id.toString(), doc);
        await this.updateIndexesOnInsert(doc);
        const updateDescription = this._getUpdateDescription(originalDoc, doc);
        this.emit('update', doc, updateDescription);
        updateCount++;
      }
    } else {
      if (options && options.upsert) {
        const newDoc = createDocFromUpdate(query, updates, new ObjectId());
        this.documents.add(newDoc._id.toString(), newDoc);
        await this.updateIndexesOnInsert(newDoc);
        this.emit('insert', newDoc);
      }
    }
    
    globalTimer.end(timer, { updatedCount: updateCount });
  }

  validate() { throw new NotImplementedError('validate', { collection: this.name }); }

  /**
   * Generate updateDescription for change events
   * Compares original and updated documents to track changes
   */
  _getUpdateDescription(originalDoc, updatedDoc) {
    const updatedFields = {};
    const removedFields = [];

    // Find updated and new fields
    for (const key in updatedDoc) {
      if (key === '_id') continue;
      if (JSON.stringify(originalDoc[key]) !== JSON.stringify(updatedDoc[key])) {
        updatedFields[key] = updatedDoc[key];
      }
    }

    // Find removed fields
    for (const key in originalDoc) {
      if (key === '_id') continue;
      if (!(key in updatedDoc)) {
        removedFields.push(key);
      }
    }

    return {
      updatedFields,
      removedFields,
      truncatedArrays: [] // Not implemented in micro-mongo
    };
  }

  /**
   * Watch for changes to this collection
   * @param {Array} pipeline - Aggregation pipeline to filter changes
   * @param {Object} options - Watch options (fullDocument, etc.)
   * @returns {ChangeStream} A change stream instance
   */
  watch(pipeline = [], options = {}) {
    return new ChangeStream(this, pipeline, options);
  }

}

/**
 * Apply projection with expression support
 * Enhanced version of applyProjection that supports computed expressions
 */
function applyProjectionWithExpressions(projection, doc) {
  const result = {};
  const keys = Object.keys(projection);

  // Check if this is an inclusion or exclusion projection
  let isInclusion = false;
  let isExclusion = false;
  let hasComputedFields = false;

  for (const key of keys) {
    if (key === '_id') continue;
    const value = projection[key];

    if (value === 1 || value === true) {
      isInclusion = true;
    } else if (value === 0 || value === false) {
      isExclusion = true;
    } else {
      // Computed field (expression)
      hasComputedFields = true;
    }
  }

  // Handle computed fields - they imply inclusion mode
  if (hasComputedFields || isInclusion) {
    // Inclusion mode: only include specified fields
    // Always include _id unless explicitly excluded
    if (projection._id !== 0 && projection._id !== false) {
      result._id = doc._id;
    }

    for (const key of keys) {
      const value = projection[key];

      if (key === '_id') {
        if (value === 0 || value === false) {
          delete result._id;
        }
      } else if (value === 1 || value === true) {
        // Simple field inclusion
        result[key] = getProp(doc, key);
      } else {
        // Computed field (expression)
        result[key] = evaluateExpression(value, doc);
      }
    }
  } else {
    // Exclusion mode: include all fields except specified ones
    for (const key in doc) {
      if (doc.hasOwnProperty(key)) {
        result[key] = doc[key];
      }
    }

    for (const key of keys) {
      if (projection[key] === 0 || projection[key] === false) {
        delete result[key];
      }
    }
  }

  return result;
}
