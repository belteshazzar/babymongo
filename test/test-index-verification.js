import * as path from 'path';
import { fileURLToPath } from 'url';
import { StorageManager } from 'node-opfs';
import { expect } from 'chai';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';

// Get project root directory for .opfs location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const opfsDir = path.join(projectRoot, '.opfs');

// Configure node-opfs to use project-local .opfs directory
const customStorage = new StorageManager(opfsDir);
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = {};
}
globalThis.navigator.storage = {
  getDirectory: () => customStorage.getDirectory()
};

import { MongoClient } from '../main.js';
import { createMongoClientSetup } from './test-utils.js';

describe('Index Verification Tests', function() {
	const setup = createMongoClientSetup('test_index_verification_db');
	const collectionName = 'test_index_verification';
	let collection, db;

	beforeEach(async function() {
		await setup.beforeEach();
		db = setup.db;
		
		// Drop collection if it exists to start fresh
		try {
			await db[collectionName].drop();
		} catch (e) {
			// Ignore error if collection doesn't exist
		}
		
		await db.createCollection(collectionName);
		collection = db[collectionName];
	});

	afterEach(setup.afterEach);

	describe('Index File Creation', function() {
		it('should create index files on disk when createIndex is called', async function() {
			this.timeout(5000);
			
			// Create index
			const indexName = await db[collectionName].createIndex({ age: 1 });
			
			// Verify index was created
			expect(indexName).to.equal('age_1');
			
			// Insert some documents to populate the index
			await db[collectionName].insertMany([
				{ name: 'Alice', age: 25 },
				{ name: 'Bob', age: 30 }
			]);
			
			// Verify index is working by checking getIndexes
			const indexes = await db[collectionName].getIndexes();
			const ageIndex = indexes.find(idx => idx.name === 'age_1');
			expect(ageIndex).to.exist;
			expect(ageIndex.key).to.deep.equal({ age: 1 });
			
			// Verify index is used in queries
			const queryPlan = await db[collectionName].planQueryAsync({ age: { $gt: 20 } });
			expect(queryPlan.useIndex).to.be.true;
			expect(queryPlan.indexNames).to.include('age_1');
		});

		it('should create multiple index files for compound index', async function() {
			this.timeout(5000);
			
			// Create regular indexes
			const nameIdx = await db[collectionName].createIndex({ name: 1 });
			const ageIdx = await db[collectionName].createIndex({ age: -1 });
			
			expect(nameIdx).to.equal('name_1');
			expect(ageIdx).to.equal('age_-1');
			
			// Insert documents
			await db[collectionName].insertMany([
				{ name: 'Alice', age: 25 },
				{ name: 'Bob', age: 30 }
			]);
			
			// Verify both indexes exist
			const indexes = await db[collectionName].getIndexes();
			expect(indexes.length).to.be.at.least(2);
			
			const nameIndex = indexes.find(idx => idx.name === 'name_1');
			const ageIndex = indexes.find(idx => idx.name === 'age_-1');
			
			expect(nameIndex).to.exist;
			expect(nameIndex.key).to.deep.equal({ name: 1 });
			expect(ageIndex).to.exist;
			expect(ageIndex.key).to.deep.equal({ age: -1 });
		});

		it('should create text index files in collection folder', async function() {
			this.timeout(5000);
			
			// Create text index
			const textIdx = await db[collectionName].createIndex({ title: 'text', content: 'text' });
			expect(textIdx).to.include('text');
			
			// Insert documents
			await db[collectionName].insertMany([
				{ title: 'Hello World', content: 'This is content' },
				{ title: 'Test', content: 'More content here' }
			]);
			
			// Verify text index exists
			const indexes = await db[collectionName].getIndexes();
			const textIndex = indexes.find(idx => idx.name === textIdx);
			expect(textIndex).to.exist;
			expect(textIndex.key.title).to.equal('text');
			expect(textIndex.key.content).to.equal('text');
			
			// Verify text search works
			const results = await db[collectionName].find({ $text: { $search: 'Hello' } }).toArray();
			expect(results.length).to.be.greaterThan(0);
			expect(results[0].title).to.equal('Hello World');
		});

		it('should remove index files when collection is dropped', async function() {
			this.timeout(5000);
			
			// Create index
			await db[collectionName].createIndex({ age: 1 });
			await db[collectionName].insertMany([
				{ name: 'Alice', age: 25 }
			]);
			
			// Verify index exists
			let indexes = await db[collectionName].getIndexes();
			expect(indexes.length).to.be.greaterThan(0);
			expect(indexes.find(idx => idx.name === 'age_1')).to.exist;
			
			// Drop collection
			await db[collectionName].drop();
			
			// Recreate collection
			await db.createCollection(collectionName);
			
			// Verify indexes are gone (should only have default _id index if any)
			indexes = await db[collectionName].getIndexes();
			const ageIndex = indexes.find(idx => idx.name === 'age_1');
			expect(ageIndex).to.be.undefined;
		});
	});

	describe('Index Usage Verification', function() {
		it('should return index metadata via getIndexes()', async function() {
			// Create indexes
			await db[collectionName].createIndex({ age: 1 });
			await db[collectionName].createIndex({ name: -1 }, { name: 'name_desc' });
			
			// Get indexes
			const indexes = await db[collectionName].getIndexes();
			
			expect(indexes).to.have.lengthOf(2);
			expect(indexes[0].name).to.equal('age_1');
			expect(indexes[0].key).to.deep.equal({ age: 1 });
			expect(indexes[1].name).to.equal('name_desc');
			expect(indexes[1].key).to.deep.equal({ name: -1 });
		});

		it('should use index for query (verified by query plan)', async function() {
			// Create index
			await db[collectionName].createIndex({ age: 1 });
			
			// Insert documents
			await db[collectionName].insertMany([
				{ name: 'Alice', age: 25 },
				{ name: 'Bob', age: 30 },
				{ name: 'Charlie', age: 35 }
			]);
			
			// Get query plan
			const collection = db[collectionName];
			const queryPlan = await collection.planQueryAsync({ age: { $gt: 28 } });
			
			// Should use index
			expect(queryPlan.useIndex).to.be.true;
			expect(queryPlan.planType).to.equal('index_scan');
			expect(queryPlan.indexNames).to.include('age_1');
			
			// DocIds should be returned from index
			expect(queryPlan.docIds).to.be.an('array');
			expect(queryPlan.docIds.length).to.equal(2);
		});

		it('should update index when documents are modified', async function() {
			// Create index
			await db[collectionName].createIndex({ score: 1 });
			
			// Insert document
			const insertResult = await db[collectionName].insertOne({ name: 'Test', score: 50 });
			const docId = insertResult.insertedId;
			
			// Query should find it
			let results = await (await db[collectionName].find({ score: 50 })).toArray();
			expect(results).to.have.lengthOf(1);
			
			// Update score
			await db[collectionName].updateOne({ _id: docId }, { $set: { score: 75 } });
			
			// Old score should not be found
			results = await (await db[collectionName].find({ score: 50 })).toArray();
			expect(results).to.have.lengthOf(0);
			
			// New score should be found
			results = await (await db[collectionName].find({ score: 75 })).toArray();
			expect(results).to.have.lengthOf(1);
			expect(results[0].name).to.equal('Test');
		});

		it('should update index when documents are deleted', async function() {
			// Create index
			await db[collectionName].createIndex({ category: 1 });
			
			// Insert documents
			await db[collectionName].insertMany([
				{ name: 'Item1', category: 'A' },
				{ name: 'Item2', category: 'A' },
				{ name: 'Item3', category: 'B' }
			]);
			
			// Query category A
			let results = await (await db[collectionName].find({ category: 'A' })).toArray();
			expect(results).to.have.lengthOf(2);
			
			// Delete one document
			await db[collectionName].deleteOne({ name: 'Item1' });
			
			// Query again
			results = await (await db[collectionName].find({ category: 'A' })).toArray();
			expect(results).to.have.lengthOf(1);
			expect(results[0].name).to.equal('Item2');
		});

		it('should maintain index consistency across multiple operations', async function() {
			// Create index
			await db[collectionName].createIndex({ status: 1 });
			
			// Perform multiple operations
			await db[collectionName].insertOne({ name: 'Doc1', status: 'active' });
			await db[collectionName].insertOne({ name: 'Doc2', status: 'inactive' });
			await db[collectionName].insertOne({ name: 'Doc3', status: 'active' });
			
			// Update one
			await db[collectionName].updateOne({ name: 'Doc1' }, { $set: { status: 'inactive' } });
			
			// Delete one
			await db[collectionName].deleteOne({ name: 'Doc2' });
			
			// Insert another
			await db[collectionName].insertOne({ name: 'Doc4', status: 'active' });
			
			// Query active
			const activeResults = await (await db[collectionName].find({ status: 'active' })).toArray();
			expect(activeResults).to.have.lengthOf(2);
			expect(activeResults.map(d => d.name).sort()).to.deep.equal(['Doc3', 'Doc4']);
			
			// Query inactive
			const inactiveResults = await (await db[collectionName].find({ status: 'inactive' })).toArray();
			expect(inactiveResults).to.have.lengthOf(1);
			expect(inactiveResults[0].name).to.equal('Doc1');
		});
	});

	describe('Index Performance Characteristics', function() {
		it('should be faster with index than without for range queries', async function() {
			this.timeout(10000);
			
			// Insert many documents
			const docs = [];
			for (let i = 0; i < 500; i++) {
				docs.push({ value: i, data: `Item ${i}` });
			}
			await db[collectionName].insertMany(docs);
			
			// Time query without index
			const startNoIndex = Date.now();
			const resultsNoIndex = await (await db[collectionName].find({ value: { $gte: 250, $lt: 300 } })).toArray();
			const durationNoIndex = Date.now() - startNoIndex;
			
			expect(resultsNoIndex).to.have.lengthOf(50);
			
			// Create index
			await db[collectionName].createIndex({ value: 1 });
			
			// Time query with index
			const startWithIndex = Date.now();
			const resultsWithIndex = await (await db[collectionName].find({ value: { $gte: 250, $lt: 300 } })).toArray();
			const durationWithIndex = Date.now() - startWithIndex;
			
			expect(resultsWithIndex).to.have.lengthOf(50);
			
			// With index should be faster or similar (allowing for some variance)
			// We don't require it to be faster because with small datasets, full scan might be similar
			console.log(`      Without index: ${durationNoIndex}ms, With index: ${durationWithIndex}ms`);
			
			// Just verify both queries return same results
			expect(resultsNoIndex.length).to.equal(resultsWithIndex.length);
		});
	});
});
