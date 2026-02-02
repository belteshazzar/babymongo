import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { MongoClient, WorkerBridge } from '../main.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe("Collection Persistence and Discovery", function() {
	this.timeout(10000);
	
	let dbName;

	before(async function() {
		// Use the default .opfs directory that the worker uses
		// Clean up to ensure fresh state
		const opfsDir = path.join(projectRoot, '.opfs');
		dbName = `testdb_persistence_${Date.now()}`;
		
		// Don't clean up .opfs completely - just clean our test database
		// The worker will use the same .opfs directory
	});

	after(async function() {
		// Clean up test database folder
		const opfsDir = path.join(projectRoot, '.opfs');
		const testDbDir = path.join(opfsDir, 'babymongo', dbName);
		try {
			await fs.rm(testDbDir, { recursive: true, force: true });
		} catch (e) {
			// Ignore errors
		}
	});

	it('should discover collections from persistent storage after reconnect', async function() {
		// Phase 1: Create database with collections and data
		const bridge1 = await WorkerBridge.create();
		const client1 = new MongoClient(`mongodb://localhost/${dbName}`, { 
			workerBridge: bridge1 
		});
		await client1.connect();
		const db1 = client1.db(dbName);
		
		// Create multiple collections with data
		await db1.collection('users').insertOne({ name: 'Alice', age: 30 });
		await db1.collection('products').insertOne({ name: 'Laptop', price: 999 });
		await db1.collection('orders').insertOne({ userId: 1, total: 150 });
		
		// Verify collections exist in first session
		const names1 = await db1.getCollectionNames();
		expect(names1).to.be.an('array');
		expect(names1).to.have.lengthOf(3);
		expect(names1).to.include.members(['users', 'products', 'orders']);
		
		// Close the first client and worker
		await client1.close();
		await bridge1.terminate();
		
		// Wait a bit to ensure everything is cleaned up
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Phase 2: Create new client/worker pointing to the same database
		const bridge2 = await WorkerBridge.create();
		const client2 = new MongoClient(`mongodb://localhost/${dbName}`, { 
			workerBridge: bridge2 
		});
		await client2.connect();
		const db2 = client2.db(dbName);
		
		
		// The critical test: getCollectionNames should discover persisted collections
		const names2 = await db2.getCollectionNames();
		expect(names2).to.be.an('array');
		expect(names2).to.have.lengthOf(3, 
			'Should discover all 3 collections from persistent storage');
		expect(names2).to.include.members(['users', 'products', 'orders'],
			'Should include all persisted collection names');
		
		// Verify data is actually there by accessing collections directly
		const user = await db2.collection('users').findOne({ name: 'Alice' });
		expect(user).to.not.be.null;
		expect(user.age).to.equal(30);
		
		const product = await db2.collection('products').findOne({ name: 'Laptop' });
		expect(product).to.not.be.null;
		expect(product.price).to.equal(999);
		
		// After accessing collections directly, they should be in the cache
		const names3 = await db2.getCollectionNames();
		expect(names3).to.have.lengthOf(3);
		
		// Clean up
		await client2.close();
		await bridge2.terminate();
	});

	it('should return empty array for new database with no collections', async function() {
		const newDbName = `empty_${Date.now()}`;
		const bridge = await WorkerBridge.create();
		const client = new MongoClient(`mongodb://localhost/${newDbName}`, { 
			workerBridge: bridge 
		});
		await client.connect();
		const db = client.db(newDbName);
		
		const names = await db.getCollectionNames();
		expect(names).to.be.an('array');
		expect(names).to.have.lengthOf(0);
		
		await client.close();
		await bridge.terminate();
	});

	it('should handle collection creation and dropping correctly', async function() {
		const testDbName = `drop_test_${Date.now()}`;
		const bridge = await WorkerBridge.create();
		const client = new MongoClient(`mongodb://localhost/${testDbName}`, { 
			workerBridge: bridge 
		});
		await client.connect();
		const db = client.db(testDbName);
		
		// Create collections
		await db.createCollection('temp1');
		await db.createCollection('temp2');
		await db.createCollection('temp3');
		
		let names = await db.getCollectionNames();
		expect(names).to.have.lengthOf(3);
		
		// Drop one collection
		await db.dropCollection('temp2');
		
		names = await db.getCollectionNames();
		expect(names).to.have.lengthOf(2);
		expect(names).to.include.members(['temp1', 'temp3']);
		expect(names).to.not.include('temp2');
		
		await client.close();
		await bridge.terminate();
	});
});
