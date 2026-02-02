import * as path from 'path';
import { fileURLToPath } from 'url';
import { StorageManager } from 'node-opfs';

// Get project root directory for .opfs location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const opfsDir = path.join(projectRoot, '.opfs');

// Configure node-opfs to use project-local .opfs directory
const customStorage = new StorageManager(opfsDir);
const opfsNavigator = {
	storage: {
		getDirectory: () => customStorage.getDirectory()
	}
};

// Ensure bjson sees OPFS APIs in Node
if (typeof globalThis.navigator === 'undefined') {
	globalThis.navigator = opfsNavigator;
} else {
	globalThis.navigator.storage = opfsNavigator.storage;
}
import {expect} from 'chai';
import * as mongo from '../main.js'
import { createMongoClientSetup } from './test-utils.js';

describe("DB no options", function() {

	const setup = createMongoClientSetup('testdb');
	let db;

	beforeEach(async function() {
		await setup.beforeEach();
		db = setup.db;
	});
	afterEach(setup.afterEach);

	it('should have no collections by default', async function() {			
		expect((await db.getCollectionNames()).length).to.equal(0);
	});

	it('should be able to create a collection with default store', async function() {			
		db.createCollection("myCollection");
		expect((await db.getCollectionNames()).length).to.equal(1);
		expect(db.myCollection).to.not.be.undefined;
	});

	it('should be able to create a collection with the provided store', async function() {			
		db.createCollection("myCollection");
		expect((await db.getCollectionNames()).length).to.equal(1);
		expect(db.myCollection).to.not.be.undefined;
	});

	it('should be able to drop collection', async function() {			
		db.createCollection("myCollection");
		expect((await db.getCollectionNames()).length).to.equal(1);
		expect(db.myCollection).to.not.be.undefined;
		await db.dropDatabase();
		expect((await db.getCollectionNames()).length).to.equal(0);
		// After dropping, accessing the collection will auto-create it (like real MongoDB)
		// So we check getCollectionNames() to verify it's truly gone
		expect(await db.getCollectionNames()).to.not.include('myCollection');
	});
});

describe("DB", function() {

	const setup = createMongoClientSetup('testdb');
	let db;

	beforeEach(async function() {
		await setup.beforeEach();
		db = setup.db;
	});
	afterEach(setup.afterEach);

	it('should have no collections by default', async function() {			
		expect((await db.getCollectionNames()).length).to.equal(0);
	});

	it('should be able to create a collection with default store', async function() {			
		db.createCollection("myCollection");
		expect((await db.getCollectionNames()).length).to.equal(1);
		expect(db.myCollection).to.not.be.undefined;
	});

	it('should be able to create a collection with the provided store', async function() {			
		db.createCollection("myCollection");
		expect((await db.getCollectionNames()).length).to.equal(1);
		expect(db.myCollection).to.not.be.undefined;
	});

	it('should be able to drop collection', async function() {			
		db.createCollection("myCollection");
		expect((await db.getCollectionNames()).length).to.equal(1);
		expect(db.myCollection).to.not.be.undefined;
		await db.dropDatabase();
		expect((await db.getCollectionNames()).length).to.equal(0);
		// After dropping, accessing the collection will auto-create it (like real MongoDB)
		// So we check getCollectionNames() to verify it's truly gone
		expect(await db.getCollectionNames()).to.not.include('myCollection');
	});

	describe('Dynamic Collection Creation (Proxy)', function() {
		
		it('should auto-create collection when accessing non-existent collection', async function() {
			expect((await db.getCollectionNames()).length).to.equal(0);
			const col = db.dynamicCollection;
			expect(col).to.not.be.undefined;
				// Access alone should not persist the collection
				expect((await db.getCollectionNames()).length).to.equal(0);
				// Persist by performing an operation
				await db.dynamicCollection.insertOne({ created: true });
				expect((await db.getCollectionNames()).length).to.equal(1);
				expect(await db.getCollectionNames()).to.include('dynamicCollection');
		});

		it('should allow inserting into dynamically created collection', async function() {
			await db.users.insertOne({ name: 'Alice', age: 30 });
			const result = await db.users.findOne({ name: 'Alice' });
			expect(result).to.not.be.null;
			expect(result.name).to.equal('Alice');
			expect(result.age).to.equal(30);
		});

		it('should allow chaining methods on dynamically created collection', async function() {
			await db.products.insertMany([
				{ name: 'Product A', price: 100 },
				{ name: 'Product B', price: 200 },
				{ name: 'Product C', price: 150 }
			]);
			const results = await db.products.find({ price: { $gt: 100 } }).toArray();
			expect(results.length).to.equal(2);
		});

		it('should return same collection instance on repeated access', async function() {
			const col1 = db.testCollection;
			const col2 = db.testCollection;
				expect(col1).to.not.equal(col2);
				await col1.insertOne({ name: 'shared' });
				const found = await col2.findOne({ name: 'shared' });
				expect(found).to.not.be.null;
		});

		it('should not create collection for internal properties', async function() {
			const options = db.options;
			expect(options).to.not.be.undefined;
			expect(await db.getCollectionNames()).to.not.include('options');
		});

		it('should work with multiple dynamically created collections', async function() {
			await db.collection1.insertOne({ value: 1 });
			await db.collection2.insertOne({ value: 2 });
			await db.collection3.insertOne({ value: 3 });
			
				const collectionNames = await db.getCollectionNames();
				expect(collectionNames.length).to.be.at.least(3);
				expect(collectionNames).to.include('collection1');
				expect(collectionNames).to.include('collection2');
				expect(collectionNames).to.include('collection3');
			expect((await db.collection1.findOne()).value).to.equal(1);
			expect((await db.collection2.findOne()).value).to.equal(2);
			expect((await db.collection3.findOne()).value).to.equal(3);
		});

		it('should allow find() on non-existent collection without error', async function() {
			const results = await db.emptyCollection.find().toArray();
			expect(results).to.be.an('array');
			expect(results.length).to.equal(0);
		});
	});
	
	describe('Collection', function() {
	
		var collectionName = "myCollection";
    const collectionName2 = "myCollection2";

		const topLeft = [
			129.64116138266587,
			-26.495442099101886
		  ];

		const bottomRight = [
			140.60850132443136,
			-35.787710083490815
		  ];

		const polygonInBox = {
			"type": "FeatureCollection",
			"features": [
			  {
				"type": "Feature",
				"properties": {},
				"geometry": {
				  "coordinates": [
					[
					  [
						135.35156670215986,
						-28.186307569105537
					  ],
					  [
						134.55964429902428,
						-29.938596403715188
					  ],
					  [
						135.83029451355912,
						-31.81378949724759
					  ],
					  [
						137.75466598994808,
						-31.60617146198912
					  ],
					  [
						138.61178466866698,
						-29.379281194259832
					  ],
					  [
						137.52154925127422,
						-27.656279872961044
					  ],
					  [
						135.35156670215986,
						-28.186307569105537
					  ]
					]
				  ],
				  "type": "Polygon"
				}
			  }
			]
		  };
		const pointInBox = {
			"type": "FeatureCollection",
			"features": [
			  {
				"type": "Feature",
				"properties": {},
				"geometry": {
				  "coordinates": [
					136.0572329703059,
					-33.100968957111704
				  ],
				  "type": "Point"
				}
			  }
			]
		  };

		const pointNotInBox = {
			"type": "FeatureCollection",
			"features": [
			  {
				"type": "Feature",
				"properties": {},
				"geometry": {
				  "coordinates": [
					146.22309564414053,
					-27.353479329645545
				  ],
				  "type": "Point"
				}
			  }
			]
		  };

		const partiallyInBox = {
			"type": "FeatureCollection",
			"features": [
			  {
				"type": "Feature",
				"properties": {},
				"geometry": {
				  "coordinates": [
					[
					  [
						134.77919638975504,
						-30.92126050109725
					  ],
					  [
						134.77919638975504,
						-32.29700946798877
					  ],
					  [
						146.3983598387441,
						-32.29700946798877
					  ],
					  [
						146.3983598387441,
						-30.92126050109725
					  ],
					  [
						134.77919638975504,
						-30.92126050109725
					  ]
					]
				  ],
				  "type": "Polygon"
				}
			  }
			]
		  };

		async function initDB() {
      await db.dropDatabase();

			db.createCollection(collectionName);
			await db[collectionName].insert({ age: 4,	legs: 0, geojson: polygonInBox });
			await db[collectionName].insert([{ age: 4, legs: 5, geojson: pointInBox },{ age: 54, legs: 2, geojson: pointNotInBox }]);
			await db[collectionName].insertMany([{ age: 54, legs: 12 },{ age: 16, geojson: partiallyInBox }]);
			await db[collectionName].insertOne({ name: "steve", text: "this is a text string with paris and london", geojson: pointInBox });
		}
		
		async function testFind(q) { 
			try {
				const results = [];
				const docs = db[collectionName].find(q);
				while (await docs.hasNext()) {
					results.push(await docs.next());
				}
				return results;
			} catch (e) {
				return e;
			}
		}
	
		async function dump() {
			const c = db[collectionName].find();
			while (await c.hasNext()) {
				console.log(await c.next());
			}
		}
	
		async function reset() {
			await db.dropDatabase();
			await initDB();
		}
			
		before(function() {
		});
	
		after(function() {
		});
	
		beforeEach(async function() {
			await initDB();
		});
	
		afterEach(function() {
			db = null;
		});
			
		it('should testCount', async function() {
			var q = { age : { $gt:3, $lt:7 }};
			if (await db[collectionName].find(q).count() != 2) throw "should be 2";
			if (await db[collectionName].count() != 6) throw "db should have 6 docs";
		});

		it('should testCopyTo', async function() {
			if ((await db.getCollectionNames()).includes(collectionName2)) throw "backup collection shouldn't exist";
			if (await db[collectionName].copyTo(collectionName2) != 6) throw "should have copied all 6 docs";
			if (!(await db.getCollectionNames()).includes(collectionName2)) throw "backup collection should have been created";
			if (await db[collectionName2].find().count() != 6) throw "failed to copy all content";
			if (await db[collectionName].find().count() != 6) throw "original collection should still have 6 docs";
			if (await db[collectionName].copyTo(collectionName2) != 6) throw "should have copied all 6 docs";
			if (await db[collectionName2].find().count() != 6) throw "failed to copy all content";
		});

		it('should testDeleteOne', async function() {
			var q = { age : { $gt:3, $lt:7 }};
			if (await db[collectionName].find(q).count() != 2) throw "should be 2";
			if (await db[collectionName].count() != 6) throw "db should have 6 docs";
			if ((await db[collectionName].deleteOne(q)).deletedCount!=1) throw "didn't delete single doc";
			if (await db[collectionName].find(q).count() != 1) throw "should be 1 after deletion";
			if (await db[collectionName].count() != 5) throw "db should have 5 docs in db after deleteion";
		});

		it('should testDeleteMany', async function() {
			var q = { age : { $gt:3, $lt:7 }};
			if (await db[collectionName].find(q).count() != 2) throw "should be 2";
			if (await db[collectionName].count() != 6) throw "db should have 6 docs";
			if ((await db[collectionName].deleteMany(q)).deletedCount!=2) throw "didn't delete 2 docs";
			if (await db[collectionName].find(q).count() != 0) throw "should be 0 after deletion";
			if (await db[collectionName].count() != 4) throw "db should have 4 docs in db after deleteion";
		});

		it('should testDistinct', async function() {
			var vals = await db[collectionName].distinct("age"); // [4,16,54]
			if (vals.length!=3) throw "3 distinct values of age";
			if (vals[0]!=4) throw "fail";
			if (vals[1]!=16) throw "fail";
			if (vals[2]!=54) throw "fail";
			var vals = await db[collectionName].distinct("age",{legs:2}); // [54]
			if (vals.length!=1) throw "fail";
			if (vals[0]!=54) throw "fail";
		});

		it('should testDrop', async function() {
			if (await db[collectionName].count() != 6) throw "db should have 6 docs";
			await db[collectionName].drop();
			if (await db[collectionName].count() != 0) throw "db should have no docs";
		});


		/************************************************************************
		 * > db.peep.find()
		 * { "_id" : ObjectId("5695be58adb5303f33363146"), "age" : 4, "legs" : 0 }
		 * { "_id" : ObjectId("5695be62adb5303f33363147"), "age" : 4, "legs" : 5 }
		 * { "_id" : ObjectId("5695be6aadb5303f33363148"), "age" : 54, "legs" : 2 }
		 * { "_id" : ObjectId("5695be73adb5303f33363149"), "age" : 54, "legs" : 12 }
		 * { "_id" : ObjectId("5695be7dadb5303f3336314a"), "name" : "steve" }
		 * { "_id" : ObjectId("56983fa1396c05c1d83a87dd"), "age" : 16 }
		 */
		it('should testFind1', async function() {
			var docs = await testFind();
			expect(docs.length).to.equal(6);
		});

		/************************************************************************
		 * > db.peep.find({age:54,legs:2})
		 * { "_id" : ObjectId("5695be6aadb5303f33363148"), "age" : 54, "legs" : 2 }
		 */
		it('should testFind2', async function() {
			var docs = await testFind({ age : 54,	legs: 2 });
			if (docs.length!=1) throw "fail";
		});


		/************************************************************************
		 * > db.peep.find({ $and: [{ age : 54},{ legs: 2 }] })
		 * { "_id" : ObjectId("5695be6aadb5303f33363148"), "age" : 54, "legs" : 2 }
		 */
		it('should testFind3', async function() {
			var docs = await testFind({ $and: [{ age : 54},{ legs: 2 }] });
			if (docs.length!=1) throw "fail";
		});


		/************************************************************************
		 * > db.peep.find({ age: { $and: [{ $eq : 54}] }, legs: 2 })
		 * Error: error: {
		 *				 "$err" : "Can't canonicalize query: BadValue unknown operator: $and",
		 *				 "code" : 17287
		 */
		it('should testFind4', async function() {
			var docs = await testFind({ age: { $and: [{ $eq : 54}] }, legs: 2 });
			if (docs.$err!="Can't canonicalize query: BadValue unknown operator: $and") throw "fail";		
		});


		/************************************************************************
		 * > db.peep.find({ age: {$gt:3, $lt: 7}})
		 * { "_id" : ObjectId("5695be58adb5303f33363146"), "age" : 4, "legs" : 0 }
		 * { "_id" : ObjectId("5695be62adb5303f33363147"), "age" : 4, "legs" : 5 }
		 */
		it('should testFind5', async function() {
			var docs = await testFind({ age : { $gt:3, $lt:7 }});
			if (docs.length!=2) throw "fail";
		});

		/************************************************************************
		 * > db.peep.find({ age: {$gt:{t:3}, $lt: 7}})
		 * 
		 * No Error produced by mongo (?)
		 */
		it('should testFind6', async function() {
			var docs = await testFind({ age: {$gt:{t:3}, $lt: 7}});
			if (docs.length!=0) throw "fail";
		});


		/************************************************************************
		 * > db.peep.find({ age: {$gt:3, lt: 7}})
		 * Error: error: {
		 *				 "$err" : "Can't canonicalize query: BadValue unknown operator: lt",
		 *				 "code" : 17287
		 * }
		 */
		it('should testFind7', async function() {
			var docs = await testFind({ age: {$gt:3, lt: 7}});
			if (docs.$err!="Can't canonicalize query: BadValue unknown operator: lt") throw "fail";
		});

		/************************************************************************
		 * > db.peep.find({ age: {gt:3, $lt: 7}})	// object comparison as no first '$'
		 */
		it('should testFind8', async function() {
			var docs = await testFind({ age: {gt:3, $lt: 7}});
			if (docs.length!=0) throw "fail";
		});

		/************************************************************************
		 * > db.peep.find({ age: {gt:3, lt: 7}}) // object comparison
		 */
		it('should testFind9', async function() {
		 var docs = await testFind({ age: {gt:3, lt: 7}});
			if (docs.length!=0) throw "fail";
		});


		/************************************************************************
		 * > db.peep.find({ age: {$gt:3, lt: 7}})
		 * Error: error: {
		 *				 "$err" : "Can't canonicalize query: BadValue unknown operator: lt",
		 *				 "code" : 17287
		 * }
		 */
		it('should testFind10', async function() {
			var docs = await testFind({ age: {$gt:3, lt: 7}});
			if (docs.$err!="Can't canonicalize query: BadValue unknown operator: lt") throw "fail";
		});

		/************************************************************************
		 * 
		 */

		it('should find text', async function() {
			var docs = await testFind({ text: {$text: "pari" }})
			expect(docs).to.not.be.null
			expect(docs.$err).to.be.undefined
			expect(docs.length).to.equal(1)
		})

		it('should not find text', async function() {
			var docs = await testFind({ text: {$text: "fred"} })
			expect(docs).to.not.be.null
			expect(docs.$err).to.be.undefined
			expect(docs.length).to.equal(0)
		})

		it('should find text in and', async function() {
			var docs = await testFind({ $and: [ { text: { $text: "paris"} },{ text: { $text: "london" }} ]})
			expect(docs).to.not.be.null
			expect(docs.$err).to.be.undefined
			expect(docs.length).to.equal(1)
		})

		/************************************************************************
		 * 
		 */
		  
		 it('should geo within bbox', async function() {
			var docs = await testFind({ geojson: { $geoWithin: [ topLeft, bottomRight ] }})
			expect(docs).to.not.be.null
			expect(docs.$err).to.be.undefined
			expect(docs.length).to.equal(3)
		})

		it('should geo witin in and', async function() {
			var docs = await testFind({ $and: [ { text: {$text: "pari" }},{ geojson: { $geoWithin: [ topLeft, bottomRight ] }} ]})
			expect(docs).to.not.be.null
			expect(docs.$err).to.be.undefined
			expect(docs.length).to.equal(1)
		})
		
		/************************************************************************
		 * 
		 */
		it('should testFindArray01', async function() {
				await db[collectionName].insert({ scores: [4,5,6] });
				await db[collectionName].insert({ scores: [3,5,7] });
			var docs = await testFind({ "scores.2" : 7});
			if (docs.length!=1) throw "fail";
			if (docs[0].scores[2]!=7) throw "Fail";
		});

		/************************************************************************
		 * 
		 */
		it('should testFindArray02', async function() {
				await db[collectionName].insert({ scores: [4,5,6] });
				await db[collectionName].insert({ scores: [3,5,7] });
			var docs = await testFind({ "scores.0" : { $lt : 4 }});
			if (docs.length!=1) throw "fail";
			if (docs[0].scores[2]!=7) throw "Fail";
		});
		
		/************************************************************************
		 * Test $all operator - matches arrays that contain all elements
		 */
		it('should find with $all operator', async function() {
			await db[collectionName].insert({ tags: ["javascript", "mongodb", "database"] });
			await db[collectionName].insert({ tags: ["javascript", "nodejs"] });
			await db[collectionName].insert({ tags: ["mongodb", "database"] });
			
			var docs = await testFind({ tags: { $all: ["javascript", "mongodb"] }});
			expect(docs.length).to.equal(1);
			expect(docs[0].tags).to.include("javascript");
			expect(docs[0].tags).to.include("mongodb");
			expect(docs[0].tags).to.include("database");
		});

		it('should not find with $all when not all elements present', async function() {
			await db[collectionName].insert({ tags: ["javascript", "nodejs"] });
			
			var docs = await testFind({ tags: { $all: ["javascript", "mongodb", "python"] }});
			expect(docs.length).to.equal(0);
		});

		/************************************************************************
		 * Test $elemMatch operator
		 */
		it('should find with $elemMatch operator', async function() {
			await db[collectionName].insert({ 
				results: [
					{ score: 80, subject: "math" },
					{ score: 90, subject: "english" }
				]
			});
			await db[collectionName].insert({ 
				results: [
					{ score: 70, subject: "math" },
					{ score: 60, subject: "english" }
				]
			});
			
			var docs = await testFind({ results: { $elemMatch: { score: { $gte: 80 }, subject: "math" }}});
			expect(docs.length).to.equal(1);
			expect(docs[0].results[0].score).to.equal(80);
		});

		it('should find with $elemMatch on simple array', async function() {
			await db[collectionName].insert({ scores: [85, 90, 75] });
			await db[collectionName].insert({ scores: [60, 70, 65] });
			
			var docs = await testFind({ scores: { $elemMatch: { $gte: 80, $lte: 90 }}});
			expect(docs.length).to.equal(1);
		});

		/************************************************************************
		 * Test $size operator
		 */
		it('should find with $size operator', async function() {
			await db[collectionName].insert({ items: ["a", "b", "c"] });
			await db[collectionName].insert({ items: ["x", "y"] });
			await db[collectionName].insert({ items: ["1"] });
			
			var docs = await testFind({ items: { $size: 3 }});
			expect(docs.length).to.equal(1);
			expect(docs[0].items.length).to.equal(3);
		});

		it('should find with $size 0 for empty arrays', async function() {
			await db[collectionName].insert({ items: [] });
			await db[collectionName].insert({ items: ["a"] });
			
			var docs = await testFind({ items: { $size: 0 }});
			expect(docs.length).to.equal(1);
			expect(docs[0].items.length).to.equal(0);
		});

		/************************************************************************
		 * Test $where operator with function
		 */
		it('should find with $where operator using function', async function() {
			await db[collectionName].insert({ price: 100, quantity: 5 });
			await db[collectionName].insert({ price: 50, quantity: 10 });
			await db[collectionName].insert({ price: 200, quantity: 2 });
			
			var docs = await testFind({ $where: function() { return this.price * this.quantity > 400; }});
			expect(docs.length).to.equal(2);
		});

		it('should find with $where operator using function in $and', async function() {
			await db[collectionName].insert({ price: 30, quantity: 20, status: "ok" });
			await db[collectionName].insert({ price: 10, quantity: 5, status: "ok" });
			await db[collectionName].insert({ price: 50, quantity: 2, status: "skip" });
			
			var docs = await testFind({
				$and: [
					{ status: "ok" },
					{ $where: function() { return this.price * this.quantity > 400; }}
				]
			});
			expect(docs.length).to.equal(1);
			expect(docs[0].status).to.equal("ok");
		});

		it('should find with $where operator using string', async function() {
			await db[collectionName].insert({ value: 100 });
			await db[collectionName].insert({ value: 50 });
			
			var docs = await testFind({ $where: "this.value > 75" });
			expect(docs.length).to.equal(1);
			expect(docs[0].value).to.equal(100);
		});

		/************************************************************************
		 * Test complex query combinations
		 */
		it('should combine $all with other operators', async function() {
			await db[collectionName].insert({ tags: ["a", "b", "c"], priority: 1 });
			await db[collectionName].insert({ tags: ["a", "b"], priority: 2 });
			await db[collectionName].insert({ tags: ["a", "b", "c"], priority: 3 });
			
			var docs = await testFind({ 
				$and: [
					{ tags: { $all: ["a", "b"] }},
					{ priority: { $gte: 2 }}
				]
			});
			expect(docs.length).to.equal(2);
		});

		it('should combine $elemMatch with $or', async function() {
			await db[collectionName].insert({ 
				scores: [{ value: 90 }, { value: 80 }],
				status: "active"
			});
			await db[collectionName].insert({ 
				scores: [{ value: 70 }, { value: 60 }],
				status: "inactive"
			});
			
			var docs = await testFind({ 
				$or: [
					{ scores: { $elemMatch: { value: { $gte: 85 }}}},
					{ status: "inactive" }
				]
			});
			expect(docs.length).to.equal(2);
		});
		
		/************************************************************************
		 * 
		 */
		it('should testFindDocument01', async function() {
		});
	
			/*
	
			> db.peep.find({age:54,legs:2},{age:1})
			{ "_id" : ObjectId("5695be6aadb5303f33363148"), "age" : 54 }
	
			> db.peep.find({age:54,legs:2},{age:0})
			{ "_id" : ObjectId("5695be6aadb5303f33363148"), "legs" : 2 }
	
			> db.peep.find({age:54,legs:2},{age:1,legs:0})
			Error: error: {
							"$err" : "Can't canonicalize query: BadValue Projection cannot have a mix of inclusion and exclusion.",
							"code" : 17287
			}
	
			> db.peep.find({age:54,legs:2},{age:1,_id:1})
			{ "_id" : ObjectId("5695be6aadb5303f33363148"), "age" : 54 }
	
			> db.peep.find({age:54,legs:2},{age:0,_id:0})
			{ "legs" : 2 }
	
	
			*/
			it('should testFind_Projection', async function() {

				function testInclusion(doc,id,age,legs) {
					if (!id != !doc._id) throw "id isn't correct";
					if (!age != !doc.age) throw "age isn't correct";
					if (!legs != !doc.legs) throw "legs isn't correct";
				}

				var q = { age:54, legs: 2 };
				if (await db[collectionName].find(q).count()!=1) throw "should be 1 doc";
				testInclusion(await db[collectionName].find(q,{age:1}).next(),true,true,false);
				testInclusion(await db[collectionName].find(q,{age:0}).next(),true,false,true);
				try {
					await db[collectionName].find(q,{age:1,legs:0});
					throw "should have raised exception";
				} catch (e) {
					if (e.code!=31254) throw `wrong error code ${e.code} != 31254`;
					if (e.$err!="Cannot do exclusion on field in inclusion projection") throw "wrong error message";
				}
				testInclusion(await db[collectionName].find(q,{age:1,_id:1}).next(),true,true,false);
				testInclusion(await db[collectionName].find(q,{age:0,_id:0}).next(),false,false,true);
				testInclusion(await db[collectionName].find(q,{}).next(),true,true,true);	 
			});

			it('should testFindAndModify', async function() {
			});

			it('should testFindOne', async function() {
				var q = { age : { $gt:3, $lt:7 }};
				if (await db[collectionName].find(q).count() != 2) throw "should be 2";
				if (!(await db[collectionName].findOne(q))) throw "should have found 1";
				if (await db[collectionName].find().count() != 6) throw "db should have 6 docs";
			});

			it('should testFindOne_Projection', async function() {

				function testInclusion(doc,id,age,legs) {
					if (!id != !doc._id) throw "id isn't correct";
					if (!age != !doc.age) throw "age isn't correct";
					if (!legs != !doc.legs) throw "legs isn't correct";
				}

				var q = { age:54, legs: 2 };
				if (!(await db[collectionName].findOne(q))) throw "should be 1 doc";
				testInclusion(await db[collectionName].findOne(q,{age:1}),true,true,false);
				testInclusion(await db[collectionName].findOne(q,{age:0}),true,false,true);
				try {
					await db[collectionName].findOne(q,{age:1,legs:0});
					throw "should have raised exception";
				} catch (e) {
					if (e.code!=31254) throw `wrong error code ${e.code} != 31254`;
					if (e.$err!="Cannot do exclusion on field in inclusion projection") throw "wrong error message";
				}
				testInclusion(await db[collectionName].findOne(q,{age:1,_id:1}),true,true,false);
				testInclusion(await db[collectionName].findOne(q,{age:0,_id:0}),false,false,true);
				testInclusion(await db[collectionName].findOne(q,{}),true,true,true);	 

			});

			it('should testFindOneAndDelete', async function() {
				if (await db[collectionName].find().count()!=6) throw "fail";
				if (await db[collectionName].find({age:54}).count()!=2) throw "need 2";
				var doc = await db[collectionName].findOneAndDelete({age:54});
				if (!doc) throw "didn't return deleted doc";
				if (await db[collectionName].find().count()!=5) throw "fail";
			});

			it('should testFindOneAndDelete_NotFound', async function() {
				if (await db[collectionName].find().count() != 6) throw "fail";
				if (await db[collectionName].find({age:74}).count() != 0) throw "need 0";
				var doc = await db[collectionName].findOneAndDelete({age:74});
				if (doc) throw "shouldn't have found anything to delete";
				if (await db[collectionName].find().count() != 6) throw "fail";
			});

			it('should testFindOneAndDelete_Sort', async function() {
				if (await db[collectionName].find().count() != 6) throw "fail";
				if (await db[collectionName].find({age:54}).count() != 2) throw "need 2";
				var first = await db[collectionName].findOne({age:54});

				var doc = await db[collectionName].findOneAndDelete({age:54});
				if (!doc) throw "should have found something to delete";

				if (await db[collectionName].find().count() != 5) throw "fail";
				if (doc._id.id != first._id.id) throw "should have deleted the first doc";

				await reset();
				
				var doc = await db[collectionName].findOneAndDelete({age:54},{ sort : { legs :1 }});
				if (!doc) throw "should have found something to delete";
				if (await db[collectionName].find().count() != 5) throw "fail";
				if (doc._id.id == first._id.id) throw "shouldnt have deleted the first doc";
			 
			});

			it('should testFindOneAndDelete_Projection', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "need 2";
				var first = await db[collectionName].findOneAndDelete({age:54},{ projection : { _id: 0, legs: 0}});
				if (!first.age) throw "age should be in projection";
				if (first._id) throw "age shouldn't be included";
				if (first.legs) throw "legs shouldn't be included";
			});

			it('should testFindOneAndReplace', async function() {
				if (await db[collectionName].findOne({age:76,legs:17})) throw "this shouldn't exist yet";
				var orig = await db[collectionName].findOne({age:54});
				if (await db[collectionName].find({age:54}).count() != 2) throw "there should be 2";
				var replaced = await db[collectionName].findOneAndReplace({age:54},{age:76,legs:17});
				if (orig._id.id != replaced._id.id) throw "replaced doc incorrect";
				if (!(await db[collectionName].findOne({age:76,legs:17}))) throw "this doc should exist now";
				if (await db[collectionName].find({age:54}).count() != 1) throw "there should only be one now";
			});

			it('should testFindOneAndReplace_NotFound', async function() {
				if (await db[collectionName].findOne({age:76,legs:17})) throw "this shouldn't exist";
				if (await db[collectionName].findOneAndReplace({age:76,legs:17},{})) throw "nothing should have been found to replace";
			});

			it('should testFindOneAndReplace_Projection', async function() {
				var replaced = await db[collectionName].findOneAndReplace({age:54},{age:76,legs:17}, { projection : {age:0}});
				if (replaced.age) throw "age should not be in projected result";
			});

			it('should testFindOneAndReplace_Sort', async function() {
				var unsorted = await db[collectionName].findOne({age:54});
				var sortOrder = 1;
				var sorted = await db[collectionName].find({age:54}).sort({legs:sortOrder}).next();
				if (unsorted._id.id == sorted._id.id) {
					sortOrder = -1;
					sorted = await db[collectionName].find({age:54}).sort({legs:sortOrder}).next();
					if (unsorted._id.id == sorted._id.id) throw "sorting should have returned a different doc";
				}
				var unsortedReplaced = await db[collectionName].findOneAndReplace({age:54},{age:76,legs:17});
				if (unsortedReplaced._id.id != unsorted._id.id) throw "replaced incorrect doc when not sorting";
				var sortedReplaced = await db[collectionName].findOneAndReplace({age:54},{age:76,legs:17}, { sort : {legs:sortOrder}});
				if (sortedReplaced._id.id != sorted._id.id) throw "replaced incorrect doc when sorting";
			});

			it('should testFindOneAndReplace_ReturnNewDocument', async function() {
				var orig = await db[collectionName].findOne({age:54});
				var replaced = await db[collectionName].findOneAndReplace({age:54},{age:76,legs:17},{returnNewDocument: false});
				if (orig._id.id != replaced._id.id) throw "should have the returned the doc being replaced";
				var newDoc = await db[collectionName].findOne({age:76,legs:17});
				var replacement = await db[collectionName].findOneAndReplace({age:76,legs:17},{age:16,legs:47},{returnNewDocument: true});
				if (!replacement._id) throw "id should have been set";
				if (newDoc._id.id != replacement._id.id) throw "the replacement/new doc should have the same id as the one replaced";
				if (replacement.age != 16) throw "doesn't appear to be the new doc (age)";
				if (replacement.legs != 47) throw "doesn't appear to be the new doc (legs)";
			});

			it('should testFindOneAndUpdate', async function() {
				var orig = await db[collectionName].findOne({age:54});
				var original = await db[collectionName].findOneAndUpdate({age:54},{ $inc : { age:2 }});
				if (orig._id.id != original._id.id) throw "orig and original id's should be teh same";
				var updated = await db[collectionName].findOne({_id:original._id});
				if (updated._id.id != orig._id.id) throw "doesn't appear to be teh same doc";
				if (orig.legs != updated.legs) throw "legs should be the same";
				if (updated.age != 56) throw "age should ahve been incremented by 2";		
			});

			it('should testFindOneAndUpdate_NotFound', async function() {
				if (await db[collectionName].findOne({age:79})) throw "this shouldn't exist";
				if (await db[collectionName].findOneAndUpdate({age:79},{ $inc : { age:2 }})) throw "should return null";
			});

			it('should testFindOneAndUpdate_Projection', async function() {
				var original = await db[collectionName].findOneAndUpdate({age:54},{ $inc : { age:2 }},{ projection: { _id:0,legs:0 }});
				if (original._id) throw "_id shouldn't be in projection";		
				if (original.legs) throw "legs shouldn't be in projection";		
				if (!original.age) throw "age should be in projection";
				if (original.age!=54) throw "age should be 54 as per the original";
				var updated = await db[collectionName].findOneAndUpdate({age:56},{ $inc : { age:2 }},{ projection: { _id:0,legs:0 },returnNewDocument: true});
				if (updated._id) throw "_id shouldn't be in projection";		
				if (updated.legs) throw "legs shouldn't be in projection";		
				if (!updated.age) throw "age should be in projection";
				if (updated.age!=58) throw "age should be 58 after updates";
			});

			it('should testFindOneAndUpdate_Sort', async function() {
				var unsorted = await db[collectionName].findOne({age:54});
				var sortOrder = 1;
				var sorted = await db[collectionName].find({age:54}).sort({legs:sortOrder}).next();
				if (unsorted._id.id == sorted._id.id) {
					sortOrder = -1;
					sorted = await db[collectionName].find({age:54}).sort({legs:sortOrder}).next();
					if (unsorted._id.id == sorted._id.id) throw "sorting should have returned a different doc";
				}
				var unsortedUpdated = await db[collectionName].findOneAndUpdate({age:54},{ $inc : { age:2 }});
				if (unsortedUpdated._id.id != unsorted._id.id) throw "updated incorrect doc when not sorting";
				var sortedUpdated = await db[collectionName].findOneAndUpdate({age:54},{ $inc : { age:2 }}, { sort : {legs:sortOrder}});
				if (sortedUpdated._id.id != sorted._id.id) throw "updated incorrect doc when sorting";
			});

			it('should testFindOneAndUpdate_ReturnNewDocument', async function() {
				var orig = await db[collectionName].findOneAndUpdate({age:54},{ $inc : { age:2 }});
				if (orig.age != 54) throw "should have returned original";
				var orig2 = await db[collectionName].findOneAndUpdate({age:56},{ $inc : { age:2 }},{ returnNewDocument: false});
				if (orig2.age != 56) throw "should have returned original";
				var updated = await db[collectionName].findOneAndUpdate({age:58},{ $inc : { age:2 }},{ returnNewDocument: true});
				if (updated.age != 60) throw "should have returned updated";
			});

			it('should testGroup', async function() {
			});

			it('should testInsert', async function() {
				if (await db[collectionName].find().count() != 6) throw "insert doesn't seem to be working in reset()";
			});

			it('should testInsertOne', async function() {
				if (await db[collectionName].find().count() != 6) throw "insert doesn't seem to be working in reset()";
			});

			it('should testInsertMany', async function() {
				if (await db[collectionName].find().count() != 6) throw "insert doesn't seem to be working in reset()";
			});

			it('should testMapReduce', async function() {
			});

			it('should testReplaceOne', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs";
				var result = await db[collectionName].replaceOne({age:54},{ cars : 3 });
				if (result.matchedCount != 2) throw "should have matched 2 documents";
				if (result.modifiedCount != 1) throw "should have replaced 1 document";
				var replaced = await db[collectionName].findOne({cars:3});
				if (replaced.cars != 3) throw "doc doesn't look like replacement";
			});

			it('should testReplaceOne_NotFound', async function() {
				if (await db[collectionName].find({age:57}).count() != 0) throw "should be no docs";
				var result = await db[collectionName].replaceOne({age:57},{ cars : 3 });
				if (result.matchedCount!=0) throw "should have matched 0 documents";
				if (result.modifiedCount!=0) throw "should have replaced 0 document";
			});

			it('should testReplaceOne_Upsert', async function() {
				if (await db[collectionName].find({age:57}).count() != 0) throw "should be no docs";
				var result = await db[collectionName].replaceOne({age:57},{ cars : 3 },{upsert: true});
				if (result.matchedCount!=0) throw "should have matched 0 documents";
				if (result.modifiedCount!=0) throw "should have replaced 0 documents";
				if (!result.upsertedId) throw "should have created new document";
				var newDoc = await db[collectionName].findOne({_id:result.upsertedId});
				if (newDoc.cars!=3) throw "new doc doesn't look like replaced doc";
			});

			it('should testRemove', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs";
				await db[collectionName].remove({age:54});
				if (await db[collectionName].find({age:54}).count() != 0) throw "should be no docs";			 
			});

			it('should testRemove_JustOneTrue', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs";
				await db[collectionName].remove({age:54},true);
				if (await db[collectionName].find({age:54}).count() != 1) throw "should be 1 doc";
			});

			it('should testRemove_JustOneFalse', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs";
				await db[collectionName].remove({age:54},false);
				if (await db[collectionName].find({age:54}).count() != 0) throw "should be no docs";
			});

			it('should testRemove_JustOneDocTrue', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs";
				await db[collectionName].remove({age:54},{ justOne : true } );
				if (await db[collectionName].find({age:54}).count() != 1) throw "should be 1 doc";
			});

			it('should testRemove_JustOneDocFalse', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs";
				await db[collectionName].remove({age:54},{ justOne : false } );
				if (await db[collectionName].find({age:54}).count() != 0) throw "should be no docs";
			});

			it('should testUpdate', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs to start with";
				await db[collectionName].update({age:54},{ $inc : { age:2 }});
				if (await db[collectionName].find({age:54}).count() != 1) throw "one doc should have been updated from 54";
				if (await db[collectionName].find({age:56}).count() != 1) throw "one doc should have been updated to 56";
			});

			it('should testUpdate_Op_Inc', async function() {
				var orig = await db[collectionName].findOne({legs:12});
				await db[collectionName].update({legs: 12},{ $inc: { age:2, legs:2 }});
				var updated = await db[collectionName].findOne({ _id: orig._id});
				if (orig._id.id != updated._id.id) throw "couldn't find updated doc";
				if (updated.age != 56) throw "age didn't get updated";
				if (updated.legs != 14) throw "legs didn't get updated";
			});

			it('should testUpdate_Op_Mul', async function() {
				var orig = await db[collectionName].findOne({legs:12});
				await db[collectionName].update({legs:12},{ $mul : { age:2, legs:2 }});
				var updated = await db[collectionName].findOne({_id:orig._id});
				if (orig._id.id != updated._id.id) throw "couldn't find updated doc";
				if (updated.age!=(54*2)) throw "age didn't get updated";
				if (updated.legs!=(12*2)) throw "legs didn't get updated";
			});

			it('should testUpdate_Op_Rename', async function() {
				var orig = await db[collectionName].findOne({legs:12});
				await db[collectionName].update({legs:12},{ $rename : { age:"cats", legs:"dogs" }});
				var updated = await db[collectionName].findOne({_id:orig._id});
				if (orig._id.id != updated._id.id) throw "couldn't find updated doc";
				if (updated.age) throw "age shouldnt exist";
				if (updated.legs) throw "legs shouldnt exist";
				if (updated.cats!=54) throw "cats should have value of age";
				if (updated.dogs!=12) throw "dogs should have value of legs";
			});

			it('should testUpdate_Op_SetOnInsert', async function() {
				if (await db[collectionName].find({age:57}).count() != 0) throw "should be no docs to start with";
				await db[collectionName].update({age:57},{ $setOnInsert: { dogs: 2, cats: 3}},{upsert:true});
				if (await db[collectionName].find({dogs:2,cats:3}).count() != 1) throw "one doc should have been created";
			});

			it('should testUpdate_Op_Set', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs to start with";
				if (await db[collectionName].find({age:54,dogs:2,cats:3}).count() != 0) throw "should be no docs";
				await db[collectionName].updateMany({age:54},{ $set: { dogs: 2, cats: 3}});
				if (await db[collectionName].find({age:54,dogs:2,cats:3}).count() != 2) throw "should be 2 docs";
			});

			it('should testUpdate_Op_Unset', async function() {
				if (await db[collectionName].find({age:54}).count() != 2) throw "should be 2 docs to start with";
				await db[collectionName].updateMany({age:54},{ $unset: { age: 2}});
				if (await db[collectionName].find({age:54}).count() != 0) throw "no docs should be returned";
			});

			it('should testUpdate_Op_Min', async function() {
				if (await db[collectionName].find({legs:10}).count() != 0) throw "should be no docs to start with";
				await db[collectionName].updateMany({legs:12},{ $min: { legs: 10}});
				if (await db[collectionName].find({legs:10}).count() != 1) throw "should have been udpated";
			});

			it('should testUpdate_Op_Max', async function() {
				if (await db[collectionName].find({legs:24}).count() != 0) throw "should be no docs to start with";
				await db[collectionName].updateMany({legs:12},{ $max: { legs: 24}});
				if (await db[collectionName].find({legs:24}).count() != 1) throw "should have been udpated";
			});

			it('should testUpdate_Op_CurrentDate', async function() {
				if (await db[collectionName].find({legs:12}).count() != 1) throw "should be 1 doc to start with";
				await db[collectionName].updateMany({legs:12},{ $currentDate: { now: 24}});
				var doc = await db[collectionName].findOne({legs:12});
				if (!doc.now) throw "now should have been set to date";
			});

			it('should testUpdate_Op_CurrentDate with boolean true', async function() {
				await db[collectionName].insert({ test: 'currentDate', value: 1 });
				await db[collectionName].updateOne({test: 'currentDate'}, { $currentDate: { timestamp: true } });
				var doc = await db[collectionName].findOne({test: 'currentDate'});
				expect(doc.timestamp).to.be.instanceOf(Date);
			});

			it('should testUpdate_Op_CurrentDate with $type date', async function() {
				await db[collectionName].insert({ test: 'currentDate', value: 2 });
				await db[collectionName].updateOne({test: 'currentDate', value: 2}, { $currentDate: { dateField: { $type: 'date' } } });
				var doc = await db[collectionName].findOne({test: 'currentDate', value: 2});
				expect(doc.dateField).to.be.instanceOf(Date);
			});

			it('should testUpdate_Op_CurrentDate with multiple fields', async function() {
				await db[collectionName].insert({ test: 'currentDate', value: 4 });
				await db[collectionName].updateOne(
					{test: 'currentDate', value: 4}, 
					{ $currentDate: { 
						dateField: { $type: 'date' },
						boolField: true
					}}
				);
				var doc = await db[collectionName].findOne({test: 'currentDate', value: 4});
				expect(doc.dateField).to.be.instanceOf(Date);
				expect(doc.boolField).to.be.instanceOf(Date);
			});

			it('should testUpdate_Op_CurrentDate with dot notation', async function() {
				await db[collectionName].insert({ test: 'currentDate', value: 5, nested: {} });
				await db[collectionName].updateOne(
					{test: 'currentDate', value: 5},
					{ $currentDate: { 'nested.timestamp': true } }
				);
				var doc = await db[collectionName].findOne({test: 'currentDate', value: 5});
				expect(doc.nested.timestamp).to.be.instanceOf(Date);
			});

			it('should testUpdate_Op_AddToSet', async function() {
				await db[collectionName].insert({ me: 7, nums: [3] });
				var orig = await db[collectionName].findOne({me:7});
				if (orig.nums.length!=1) throw "array of length 1 should exist";
				await db[collectionName].update({me:7},{ $addToSet : { nums : [4,5] }});
				var updated = await db[collectionName].findOne({me:7});
				if (updated.nums.length!=2) throw "array of length 2 should exist";
				if (updated.nums[1].length!=2) throw "array of length 2 should exist";
			});

			it('should testUpdate_Op_Pop', async function() {
				await db[collectionName].insert({ me: 7, nums: [1,2,3,4,5,6] });
				await db[collectionName].update({me:7},{ $pop : {nums:1} });
				var doc = await db[collectionName].findOne({me:7});
				if (doc.nums.length!=5) throw "incorrect length";
				if (doc.nums[0]!=1) throw "first element should be 1";
				if (doc.nums[doc.nums.length-1]!=5) throw "last element should be 5";
				await db[collectionName].update({me:7},{ $pop : {nums:-1} });
				var doc = await db[collectionName].findOne({me:7});
				if (doc.nums.length!=4) throw "incorrect length";
				if (doc.nums[0]!=2) throw "first element should be 2";
				if (doc.nums[doc.nums.length-1]!=5) throw "last element should be 5";
			});

			it('should testUpdate_Op_PullAll', async function() {
				await db[collectionName].insert({ me: 7, nums: [3,5,2,3,4,5,2,5] });
				await db[collectionName].update({me:7},{ $pullAll : {nums:[3,5]} });
				var doc = await db[collectionName].findOne({me:7});	// nums = [2,4,2]
				if (doc.nums.length!=3) throw "incorrect length";
				if (doc.nums[0]!=2) throw "[0] element should be 2";
				if (doc.nums[1]!=4) throw "[1] element should be 4";
				if (doc.nums[2]!=2) throw "[2] element should be 2";
			});

			it('should testUpdate_Op_Pull', async function() {
				// Test 1: Simple value matching
				await db[collectionName].insert({ me: 1, nums: [1, 2, 3, 4, 5] });
				await db[collectionName].update({me:1},{ $pull : {nums: 3} });
				var doc = await db[collectionName].findOne({me:1});
				if (doc.nums.length!=4) throw "Test 1: incorrect length";
				if (doc.nums.includes(3)) throw "Test 1: should have removed 3";
				if (doc.nums[0]!=1 || doc.nums[1]!=2 || doc.nums[2]!=4 || doc.nums[3]!=5) throw "Test 1: wrong values";
				
				// Test 2: Query condition with $gte
				await db[collectionName].insert({ me: 2, nums: [1, 2, 3, 4, 5, 6] });
				await db[collectionName].update({me:2},{ $pull : {nums: {$gte: 5}} });
				doc = await db[collectionName].findOne({me:2});
				if (doc.nums.length!=4) throw "Test 2: incorrect length, got " + doc.nums.length;
				if (doc.nums.includes(5) || doc.nums.includes(6)) throw "Test 2: should have removed values >= 5";
				if (doc.nums[0]!=1 || doc.nums[1]!=2 || doc.nums[2]!=3 || doc.nums[3]!=4) throw "Test 2: wrong remaining values";
				
				// Test 3: Query condition with $lt
				await db[collectionName].insert({ me: 3, nums: [1, 2, 3, 4, 5] });
				await db[collectionName].update({me:3},{ $pull : {nums: {$lt: 3}} });
				doc = await db[collectionName].findOne({me:3});
				if (doc.nums.length!=3) throw "Test 3: incorrect length";
				if (doc.nums.includes(1) || doc.nums.includes(2)) throw "Test 3: should have removed values < 3";
				
				// Test 4: Nested object matching with query conditions
				await db[collectionName].insert({ 
					me: 4, 
					items: [
						{name: "apple", price: 10},
						{name: "banana", price: 5},
						{name: "cherry", price: 15},
						{name: "date", price: 8}
					]
				});
				await db[collectionName].update({me:4},{ $pull : {items: {price: {$gte: 10}}} });
				doc = await db[collectionName].findOne({me:4});
				if (doc.items.length!=2) throw "Test 4: incorrect length, got " + doc.items.length;
				if (doc.items.some(item => item.price >= 10)) throw "Test 4: should have removed items with price >= 10";
				
				// Test 5: Plain object matching (exact match)
				await db[collectionName].insert({ 
					me: 5, 
					items: [
						{name: "apple", price: 10},
						{name: "banana", price: 5},
						{name: "apple", price: 10}
					]
				});
				await db[collectionName].update({me:5},{ $pull : {items: {name: "apple", price: 10}} });
				doc = await db[collectionName].findOne({me:5});
				if (doc.items.length!=1) throw "Test 5: incorrect length, got " + doc.items.length;
				if (doc.items[0].name != "banana" || doc.items[0].price != 5) throw "Test 5: wrong remaining item";
				
				// Test 6: Multiple values matching same condition
				await db[collectionName].insert({ me: 6, nums: [3, 5, 3, 7, 3] });
				await db[collectionName].update({me:6},{ $pull : {nums: 3} });
				doc = await db[collectionName].findOne({me:6});
				if (doc.nums.length!=2) throw "Test 6: incorrect length";
				if (doc.nums.includes(3)) throw "Test 6: should have removed all 3s";
				if (doc.nums[0]!=5 || doc.nums[1]!=7) throw "Test 6: wrong values";
				
				// Test 7: No matches (array unchanged)
				await db[collectionName].insert({ me: 7, nums: [1, 2, 3] });
				await db[collectionName].update({me:7},{ $pull : {nums: 10} });
				doc = await db[collectionName].findOne({me:7});
				if (doc.nums.length!=3) throw "Test 7: incorrect length";
				
				// Test 8: Empty array after pull
				await db[collectionName].insert({ me: 8, nums: [5, 5, 5] });
				await db[collectionName].update({me:8},{ $pull : {nums: 5} });
				doc = await db[collectionName].findOne({me:8});
				if (doc.nums.length!=0) throw "Test 8: should be empty array";
			});

			it('should testUpdate_Op_Pull_EdgeCases', async function() {
				// Test with $in operator
				await db[collectionName].insert({ me: 1, nums: [1, 2, 3, 4, 5, 6] });
				await db[collectionName].update({me:1},{ $pull : {nums: {$in: [2, 4, 6]}} });
				var doc = await db[collectionName].findOne({me:1});
				if (doc.nums.length!=3) throw "Test $in: incorrect length";
				if (doc.nums.includes(2) || doc.nums.includes(4) || doc.nums.includes(6)) throw "Test $in: should have removed even numbers in list";
				
				// Test with $nin operator
				await db[collectionName].insert({ me: 2, nums: [1, 2, 3, 4, 5] });
				await db[collectionName].update({me:2},{ $pull : {nums: {$nin: [2, 4]}} });
				doc = await db[collectionName].findOne({me:2});
				if (doc.nums.length!=2) throw "Test $nin: incorrect length";
				if (!doc.nums.includes(2) || !doc.nums.includes(4)) throw "Test $nin: should only keep 2 and 4";
				
				// Test with $ne operator
				await db[collectionName].insert({ me: 3, nums: [1, 2, 3, 2, 1] });
				await db[collectionName].update({me:3},{ $pull : {nums: {$ne: 2}} });
				doc = await db[collectionName].findOne({me:3});
				if (doc.nums.length!=2) throw "Test $ne: incorrect length";
				if (doc.nums[0]!=2 || doc.nums[1]!=2) throw "Test $ne: should only keep 2s";
				
				// Test with nested object and multiple conditions
				await db[collectionName].insert({ 
					me: 4, 
					items: [
						{name: "apple", price: 10, qty: 5},
						{name: "banana", price: 5, qty: 10},
						{name: "cherry", price: 15, qty: 3},
						{name: "date", price: 8, qty: 20}
					]
				});
				await db[collectionName].update({me:4},{ $pull : {items: {price: {$lt: 10}, qty: {$gt: 5}}} });
				doc = await db[collectionName].findOne({me:4});
				if (doc.items.length!=2) throw "Test multiple conditions: incorrect length, got " + doc.items.length;
				// Should remove banana (price 5 < 10 AND qty 10 > 5) and date (price 8 < 10 AND qty 20 > 5)
				if (doc.items.some(item => item.name === "date")) throw "Test multiple conditions: should have removed date";
				if (doc.items.some(item => item.name === "banana")) throw "Test multiple conditions: should have removed banana";
				if (!doc.items.some(item => item.name === "apple")) throw "Test multiple conditions: should have kept apple";
				if (!doc.items.some(item => item.name === "cherry")) throw "Test multiple conditions: should have kept cherry";
				
				// Test with $mod operator
				await db[collectionName].insert({ me: 5, nums: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
				await db[collectionName].update({me:5},{ $pull : {nums: {$mod: [3, 0]}} });
				doc = await db[collectionName].findOne({me:5});
				// Should remove 3, 6, 9 (divisible by 3)
				if (doc.nums.includes(3) || doc.nums.includes(6) || doc.nums.includes(9)) throw "Test $mod: should have removed multiples of 3";
				if (doc.nums.length!=7) throw "Test $mod: incorrect length";
				
				// Test on non-existent field (should not error)
				await db[collectionName].insert({ me: 6 });
				await db[collectionName].update({me:6},{ $pull : {nonexistent: 5} });
				doc = await db[collectionName].findOne({me:6});
				if (doc.nonexistent !== undefined) throw "Test non-existent: field should remain undefined";
				
				// Test on non-array field (should not error)
				await db[collectionName].insert({ me: 7, notArray: "string" });
				await db[collectionName].update({me:7},{ $pull : {notArray: "s"} });
				doc = await db[collectionName].findOne({me:7});
				if (doc.notArray !== "string") throw "Test non-array: should not modify non-array field";
			});

			it('should testUpdate_Op_PushAll', async function() {
				await db[collectionName].insert({ me: 7, nums: [3] });
				await db[collectionName].update({me:7},{ $pushAll : {nums:[4,5]} });
				var doc = await db[collectionName].findOne({me:7});
				if (doc.nums.length!=3) throw "incorrect length";
				if (doc.nums[0]!=3) throw "[0] element should be 3";
				if (doc.nums[1]!=4) throw "[1] element should be 4";
				if (doc.nums[2]!=5) throw "[2] element should be 5";
			});

			it('should testUpdate_Op_Push', async function() {
				await db[collectionName].insert({ me: 7, nums: [3] });
				await db[collectionName].update({me:7},{ $push : {nums:4} });
				var doc = await db[collectionName].findOne({me:7});
				if (doc.nums.length!=2) throw "incorrect length";
				if (doc.nums[0]!=3) throw "[0] element should be 3";
				if (doc.nums[1]!=4) throw "[1] element should be 4";
			});

			it('should testUpdate_Op_AllPositional', async function() {
				// Test $[] operator - update all array elements
				await db[collectionName].insert({ 
					me: 8, 
					items: [
						{ name: "apple", quantity: 5 },
						{ name: "banana", quantity: 10 },
						{ name: "cherry", quantity: 15 }
					]
				});
				
				// Update quantity of all items
				await db[collectionName].update({ me: 8 }, { $set: { "items.$[].quantity": 0 } });
				var doc = await db[collectionName].findOne({ me: 8 });
				if (doc.items.length != 3) throw "should have 3 items";
				if (doc.items[0].quantity != 0) throw "items[0].quantity should be 0";
				if (doc.items[1].quantity != 0) throw "items[1].quantity should be 0";
				if (doc.items[2].quantity != 0) throw "items[2].quantity should be 0";
				
				// Test with $inc operator
				await db[collectionName].update({ me: 8 }, { $inc: { "items.$[].quantity": 5 } });
				doc = await db[collectionName].findOne({ me: 8 });
				if (doc.items[0].quantity != 5) throw "items[0].quantity should be 5";
				if (doc.items[1].quantity != 5) throw "items[1].quantity should be 5";
				if (doc.items[2].quantity != 5) throw "items[2].quantity should be 5";
				
				// Test with $mul operator
				await db[collectionName].update({ me: 8 }, { $mul: { "items.$[].quantity": 2 } });
				doc = await db[collectionName].findOne({ me: 8 });
				if (doc.items[0].quantity != 10) throw "items[0].quantity should be 10";
				if (doc.items[1].quantity != 10) throw "items[1].quantity should be 10";
				if (doc.items[2].quantity != 10) throw "items[2].quantity should be 10";
				
				// Test with $min operator
				await db[collectionName].update({ me: 8 }, { $min: { "items.$[].quantity": 7 } });
				doc = await db[collectionName].findOne({ me: 8 });
				if (doc.items[0].quantity != 7) throw "items[0].quantity should be 7";
				if (doc.items[1].quantity != 7) throw "items[1].quantity should be 7";
				if (doc.items[2].quantity != 7) throw "items[2].quantity should be 7";
				
				// Test with $max operator
				await db[collectionName].update({ me: 8 }, { $max: { "items.$[].quantity": 12 } });
				doc = await db[collectionName].findOne({ me: 8 });
				if (doc.items[0].quantity != 12) throw "items[0].quantity should be 12";
				if (doc.items[1].quantity != 12) throw "items[1].quantity should be 12";
				if (doc.items[2].quantity != 12) throw "items[2].quantity should be 12";
				
				// Test simple array update
				await db[collectionName].insert({ me: 9, scores: [10, 20, 30] });
				await db[collectionName].update({ me: 9 }, { $set: { "scores.$[]": 100 } });
				doc = await db[collectionName].findOne({ me: 9 });
				if (doc.scores.length != 3) throw "should have 3 scores";
				if (doc.scores[0] != 100) throw "scores[0] should be 100";
				if (doc.scores[1] != 100) throw "scores[1] should be 100";
				if (doc.scores[2] != 100) throw "scores[2] should be 100";
				
				// Test nested array update
				await db[collectionName].insert({ 
					me: 10, 
					students: [
						{ grades: [70, 80, 90] },
						{ grades: [60, 75, 85] }
					]
				});
				await db[collectionName].update({ me: 10 }, { $inc: { "students.$[].grades.$[]": 5 } });
				doc = await db[collectionName].findOne({ me: 10 });
				if (doc.students[0].grades[0] != 75) throw "students[0].grades[0] should be 75";
				if (doc.students[0].grades[1] != 85) throw "students[0].grades[1] should be 85";
				if (doc.students[0].grades[2] != 95) throw "students[0].grades[2] should be 95";
				if (doc.students[1].grades[0] != 65) throw "students[1].grades[0] should be 65";
				if (doc.students[1].grades[1] != 80) throw "students[1].grades[1] should be 80";
				if (doc.students[1].grades[2] != 90) throw "students[1].grades[2] should be 90";
			});

			it('should testUpdate_Op_Each', async function() {
				await db[collectionName].insert({ me: 7, nums: [1, 2] });
				await db[collectionName].update({me:7}, { $push: { nums: { $each: [3, 4, 5] } } });
				var doc = await db[collectionName].findOne({me:7});
				if (doc.nums.length !== 5) throw "incorrect length: " + doc.nums.length;
				if (doc.nums[0] !== 1) throw "[0] element should be 1";
				if (doc.nums[1] !== 2) throw "[1] element should be 2";
				if (doc.nums[2] !== 3) throw "[2] element should be 3";
				if (doc.nums[3] !== 4) throw "[3] element should be 4";
				if (doc.nums[4] !== 5) throw "[4] element should be 5";
			});

			it('should testUpdate_Op_Slice', async function() {
				// Test positive slice (keep first N)
				await db[collectionName].insert({ me: 8, nums: [1, 2, 3] });
				await db[collectionName].update({me:8}, { $push: { nums: { $each: [4, 5], $slice: 3 } } });
				var doc = await db[collectionName].findOne({me:8});
				if (doc.nums.length !== 3) throw "incorrect length: " + doc.nums.length;
				if (doc.nums[0] !== 1) throw "[0] element should be 1";
				if (doc.nums[1] !== 2) throw "[1] element should be 2";
				if (doc.nums[2] !== 3) throw "[2] element should be 3";
				
				// Test negative slice (keep last N)
				await db[collectionName].remove({me:8});
				await db[collectionName].insert({ me: 8, nums: [1, 2, 3] });
				await db[collectionName].update({me:8}, { $push: { nums: { $each: [4, 5], $slice: -3 } } });
				doc = await db[collectionName].findOne({me:8});
				if (doc.nums.length !== 3) throw "incorrect length for negative slice: " + doc.nums.length;
				if (doc.nums[0] !== 3) throw "[0] element should be 3";
				if (doc.nums[1] !== 4) throw "[1] element should be 4";
				if (doc.nums[2] !== 5) throw "[2] element should be 5";
			});

			it('should testUpdate_Op_Sort', async function() {
				// Test numeric sort ascending
				await db[collectionName].insert({ me: 9, nums: [5, 2, 8] });
				await db[collectionName].update({me:9}, { $push: { nums: { $each: [1, 9], $sort: 1 } } });
				var doc = await db[collectionName].findOne({me:9});
				if (doc.nums.length !== 5) throw "incorrect length: " + doc.nums.length;
				if (doc.nums[0] !== 1) throw "[0] element should be 1";
				if (doc.nums[1] !== 2) throw "[1] element should be 2";
				if (doc.nums[2] !== 5) throw "[2] element should be 5";
				if (doc.nums[3] !== 8) throw "[3] element should be 8";
				if (doc.nums[4] !== 9) throw "[4] element should be 9";
				
				// Test numeric sort descending
				await db[collectionName].remove({me:9});
				await db[collectionName].insert({ me: 9, nums: [5, 2, 8] });
				await db[collectionName].update({me:9}, { $push: { nums: { $each: [1, 9], $sort: -1 } } });
				doc = await db[collectionName].findOne({me:9});
				if (doc.nums.length !== 5) throw "incorrect length for desc sort: " + doc.nums.length;
				if (doc.nums[0] !== 9) throw "[0] element should be 9";
				if (doc.nums[1] !== 8) throw "[1] element should be 8";
				if (doc.nums[2] !== 5) throw "[2] element should be 5";
				if (doc.nums[3] !== 2) throw "[3] element should be 2";
				if (doc.nums[4] !== 1) throw "[4] element should be 1";
				
				// Test sort by subdocument field
				await db[collectionName].remove({me:9});
				await db[collectionName].insert({ me: 9, items: [{score: 5}, {score: 2}] });
				await db[collectionName].update({me:9}, { $push: { items: { $each: [{score: 8}, {score: 1}], $sort: {score: 1} } } });
				doc = await db[collectionName].findOne({me:9});
				if (doc.items.length !== 4) throw "incorrect length for object sort: " + doc.items.length;
				if (doc.items[0].score !== 1) throw "[0] score should be 1";
				if (doc.items[1].score !== 2) throw "[1] score should be 2";
				if (doc.items[2].score !== 5) throw "[2] score should be 5";
				if (doc.items[3].score !== 8) throw "[3] score should be 8";
			});

			it('should testUpdate_Op_Position', async function() {
				// Test position at beginning
				await db[collectionName].insert({ me: 10, nums: [1, 2, 3] });
				await db[collectionName].update({me:10}, { $push: { nums: { $each: [4, 5], $position: 0 } } });
				var doc = await db[collectionName].findOne({me:10});
				if (doc.nums.length !== 5) throw "incorrect length: " + doc.nums.length;
				if (doc.nums[0] !== 4) throw "[0] element should be 4";
				if (doc.nums[1] !== 5) throw "[1] element should be 5";
				if (doc.nums[2] !== 1) throw "[2] element should be 1";
				if (doc.nums[3] !== 2) throw "[3] element should be 2";
				if (doc.nums[4] !== 3) throw "[4] element should be 3";
				
				// Test position in middle
				await db[collectionName].remove({me:10});
				await db[collectionName].insert({ me: 10, nums: [1, 2, 3] });
				await db[collectionName].update({me:10}, { $push: { nums: { $each: [4, 5], $position: 1 } } });
				doc = await db[collectionName].findOne({me:10});
				if (doc.nums.length !== 5) throw "incorrect length for middle position: " + doc.nums.length;
				if (doc.nums[0] !== 1) throw "[0] element should be 1";
				if (doc.nums[1] !== 4) throw "[1] element should be 4";
				if (doc.nums[2] !== 5) throw "[2] element should be 5";
				if (doc.nums[3] !== 2) throw "[3] element should be 2";
				if (doc.nums[4] !== 3) throw "[4] element should be 3";
				
				// Test negative position (from end)
				await db[collectionName].remove({me:10});
				await db[collectionName].insert({ me: 10, nums: [1, 2, 3] });
				await db[collectionName].update({me:10}, { $push: { nums: { $each: [4, 5], $position: -1 } } });
				doc = await db[collectionName].findOne({me:10});
				if (doc.nums.length !== 5) throw "incorrect length for negative position: " + doc.nums.length;
				if (doc.nums[0] !== 1) throw "[0] element should be 1";
				if (doc.nums[1] !== 2) throw "[1] element should be 2";
				if (doc.nums[2] !== 4) throw "[2] element should be 4";
				if (doc.nums[3] !== 5) throw "[3] element should be 5";
				if (doc.nums[4] !== 3) throw "[4] element should be 3";
			});

			it('should testUpdate_Op_Push_Combined_Modifiers', async function() {
				// Test combining $each, $position, $sort, and $slice
				// This should: insert at position, add values, sort, then slice
				await db[collectionName].insert({ me: 11, nums: [40, 30, 20] });
				await db[collectionName].update({me:11}, { 
					$push: { 
						nums: { 
							$each: [60, 50, 10], 
							$position: 0,
							$sort: 1,
							$slice: 4
						} 
					} 
				});
				var doc = await db[collectionName].findOne({me:11});
				// After position: [60, 50, 10, 40, 30, 20]
				// After sort: [10, 20, 30, 40, 50, 60]
				// After slice(4): [10, 20, 30, 40]
				if (doc.nums.length !== 4) throw "incorrect length for combined: " + doc.nums.length;
				if (doc.nums[0] !== 10) throw "[0] element should be 10, got " + doc.nums[0];
				if (doc.nums[1] !== 20) throw "[1] element should be 20, got " + doc.nums[1];
				if (doc.nums[2] !== 30) throw "[2] element should be 30, got " + doc.nums[2];
				if (doc.nums[3] !== 40) throw "[3] element should be 40, got " + doc.nums[3];
			});

			it('should testUpdate_Op_Bit', async function() {
				await db[collectionName].insert({ me: 7, val : 4 });
				await db[collectionName].update({me:7},{$bit:{val: {or:3}}});
				var doc = await db[collectionName].findOne({me:7});
				if (doc.val!=7) throw "4 or 3 = 7";
				await db[collectionName].update({me:7},{$bit:{val: {and:14}}});
				var doc = await db[collectionName].findOne({me:7});
				if (doc.val!=6) throw "7 and 14 = 6";
				await db[collectionName].update({me:7},{$bit:{val: {xor:10}}});
				var doc = await db[collectionName].findOne({me:7});
				if (doc.val!=12) throw "6 xor 10 = 12";
			});

			it('should testUpdate_Op_Isolated', async function() {
			});

			it('should testUpdate_Multi', async function() {
				if (await db[collectionName].find({age:54}).count()!=2) throw "should be 2 docs to start with";
			await db[collectionName].update({age:54},{ $inc : { age:2 }},{multi:true});
			});

			it('should testUpdate_Upsert', async function() {
				if (await db[collectionName].find({age:57}).count()!=0) throw "should be no docs to start with";
				await db[collectionName].update({age:57},{ $inc : { age:2 }},{upsert:true});
				if (await db[collectionName].find({age:59}).count()!=1) throw "one doc should have been created with age:59";
			});

			it('should testUpdateOne', async function() {
				if (await db[collectionName].find({age:54}).count()!=2) throw "should be 2 docs to start with";
				await db[collectionName].updateOne({age:54},{ $inc : { age:2 }});
				if (await db[collectionName].find({age:54}).count()!=1) throw "one doc should have been updated from 54";
				if (await db[collectionName].find({age:56}).count()!=1) throw "one doc should have been updated to 56";
			});
	
			it('should testUpdateOne_Upsert', async function() {
				if (await db[collectionName].find({age:57}).count()!=0) throw "should be no docs to start with";
				await db[collectionName].updateOne({age:57},{ $inc : { age:2 }},{ upsert: true});
				if (await db[collectionName].find({age:59}).count()!=1) throw "new doc should have been created with age:59";
			});

			it('should testUpdateMany', async function() {
				if (await db[collectionName].find({age:54}).count()!=2) throw "should be 2 docs to start with";
				await db[collectionName].updateMany({age:54},{ $inc : { age:2 }});
				if (await db[collectionName].find({age:54}).count()!=0) throw "these docs should have been updated from 54";
				if (await db[collectionName].find({age:56}).count()!=2) throw "these docs should have been updated to 56";
			});

			it('should testUpdateMany_Upsert', async function() {
				if (await db[collectionName].find({age:57}).count()!=0) throw "should be no docs to start with";
				await db[collectionName].updateMany({age:57},{ $inc : { age:2 }},{ upsert: true});
				if (await db[collectionName].find({age:59}).count()!=1) throw "new doc should have been created with age:59";
			});

			/************************************************************************
			 * Aggregation Pipeline Tests
			 */
			describe('Aggregation', function() {
				
				it('should aggregate with $match stage', async function() {
					var results = await db[collectionName].aggregate([
						{ $match: { age: { $gte: 16 }}}
					]);
					expect(results.length).to.equal(3);
				});

				it('should aggregate with $project stage', async function() {
					var results = await db[collectionName].aggregate([
						{ $match: { age: 54 }},
						{ $project: { age: 1 }}
					]);
					expect(results.length).to.equal(2);
					expect(results[0].age).to.equal(54);
					expect(results[0].legs).to.be.undefined;
				});

				it('should aggregate with $sort stage', async function() {
					var results = await db[collectionName].aggregate([
						{ $match: { age: { $exists: true }}},
						{ $sort: { age: 1 }}
					]);
					expect(results[0].age).to.equal(4);
					expect(results[results.length - 1].age).to.equal(54);
				});

				it('should aggregate with $limit stage', async function() {
					var results = await db[collectionName].aggregate([
						{ $match: {}},
						{ $limit: 3 }
					]);
					expect(results.length).to.equal(3);
				});

				it('should aggregate with $skip stage', async function() {
					var results = await db[collectionName].aggregate([
						{ $match: {}},
						{ $sort: { age: 1 }},
						{ $skip: 2 }
					]);
					expect(results.length).to.equal(4);
				});

				it('should aggregate with $group and $sum', async function() {
					var results = await db[collectionName].aggregate([
						{ $group: { 
							_id: "$age", 
							count: { $sum: 1 },
							totalLegs: { $sum: "$legs" }
						}}
					]);
					// Find the group with age 54
					var group54 = await results.find(r => r._id === 54);
					expect(group54).to.not.be.undefined;
					expect(group54.count).to.equal(2);
				});

				it('should aggregate with $group and $avg', async function() {
					await db[collectionName].insert({ category: "A", value: 10 });
					await db[collectionName].insert({ category: "A", value: 20 });
					await db[collectionName].insert({ category: "B", value: 30 });
					
					var results = await db[collectionName].aggregate([
						{ $match: { category: { $exists: true }}},
						{ $group: { 
							_id: "$category", 
							avgValue: { $avg: "$value" }
						}}
					]);
					var groupA = await results.find(r => r._id === "A");
					expect(groupA.avgValue).to.equal(15);
				});

				it('should aggregate with $group and $min/$max', async function() {
					await db[collectionName].insert({ type: "test", score: 85 });
					await db[collectionName].insert({ type: "test", score: 92 });
					await db[collectionName].insert({ type: "test", score: 78 });
					
					var results = await db[collectionName].aggregate([
						{ $match: { type: "test" }},
						{ $group: { 
							_id: "$type", 
							minScore: { $min: "$score" },
							maxScore: { $max: "$score" }
						}}
					]);
					expect(results[0].minScore).to.equal(78);
					expect(results[0].maxScore).to.equal(92);
				});

				it('should aggregate with $group and $push', async function() {
					await db[collectionName].insert({ team: "A", player: "Alice" });
					await db[collectionName].insert({ team: "A", player: "Bob" });
					await db[collectionName].insert({ team: "B", player: "Charlie" });
					
					var results = await db[collectionName].aggregate([
						{ $match: { team: { $exists: true }}},
						{ $group: { 
							_id: "$team", 
							players: { $push: "$player" }
						}}
					]);
					var teamA = await results.find(r => r._id === "A");
					expect(teamA.players.length).to.equal(2);
					expect(teamA.players).to.include("Alice");
					expect(teamA.players).to.include("Bob");
				});

				it('should aggregate with $group and $addToSet', async function() {
					await db[collectionName].insert({ dept: "IT", skill: "JavaScript" });
					await db[collectionName].insert({ dept: "IT", skill: "Python" });
					await db[collectionName].insert({ dept: "IT", skill: "JavaScript" });
					
					var results = await db[collectionName].aggregate([
						{ $match: { dept: "IT" }},
						{ $group: { 
							_id: "$dept", 
							skills: { $addToSet: "$skill" }
						}}
					]);
					expect(results[0].skills.length).to.equal(2);
				});

				it('should aggregate with $group and $first/$last', async function() {
					await db[collectionName].insert({ order: 1, value: "first" });
					await db[collectionName].insert({ order: 2, value: "second" });
					await db[collectionName].insert({ order: 3, value: "third" });
					
					var results = await db[collectionName].aggregate([
						{ $match: { order: { $exists: true }}},
						{ $sort: { order: 1 }},
						{ $group: { 
							_id: null, 
							firstValue: { $first: "$value" },
							lastValue: { $last: "$value" }
						}}
					]);
					expect(results[0].firstValue).to.equal("first");
					expect(results[0].lastValue).to.equal("third");
				});

				it('should aggregate with $count stage', async function() {
					var results = await db[collectionName].aggregate([
						{ $match: { age: { $gte: 16 }}},
						{ $count: "total" }
					]);
					expect(results.length).to.equal(1);
					expect(results[0].total).to.equal(3);
				});

				it('should aggregate with $unwind stage', async function() {
					await db[collectionName].insert({ name: "Product1", tags: ["a", "b", "c"] });
					
					var results = await db[collectionName].aggregate([
						{ $match: { name: "Product1" }},
						{ $unwind: "$tags" }
					]);
					expect(results.length).to.equal(3);
					expect(results[0].tags).to.equal("a");
					expect(results[1].tags).to.equal("b");
					expect(results[2].tags).to.equal("c");
				});

				it('should aggregate with multiple stages combined', async function() {
					await db[collectionName].insert({ category: "X", price: 100, quantity: 2 });
					await db[collectionName].insert({ category: "X", price: 50, quantity: 5 });
					await db[collectionName].insert({ category: "Y", price: 200, quantity: 1 });
					
					var results = await db[collectionName].aggregate([
						{ $match: { category: { $exists: true }}},
						{ $group: { 
							_id: "$category", 
							count: { $sum: 1 },
							avgPrice: { $avg: "$price" }
						}},
						{ $sort: { avgPrice: -1 }},
						{ $limit: 2 }
					]);
					expect(results.length).to.be.lte(2);
					expect(results[0]._id).to.equal("Y");
				});

				it('should handle empty pipeline', async function() {
					var results = await db[collectionName].aggregate([]);
					expect(results.length).to.equal(6); // Original docs
				});
			});
			
			describe('Cursor', function() {

			it('should testCount', async function() {
				var c = db[collectionName].find();
				if (await c.count() != 6) throw "incorrect count";
				while (await c.hasNext()) {
					await c.next();
					if (await c.count() != 6) throw "incorrect count";
				}
			});
				
			it('should testForEach', async function() {
				var numLegs = 0;
				var numDocs = 0;
				await db[collectionName].find().forEach(function(doc) {
					numDocs++;
					if (doc.legs) numLegs += doc.legs;
				});
				if (numDocs!=6) throw "total number of docs != 6";
				if (numLegs!=19) throw "total number of legs != 19";
			});

			it('should testHasNext', async function() {
				var c = db[collectionName].find();
				while (await c.hasNext()) {
					await c.next();
				}
			});

			it('should testLimit', async function() {
				var count = 0;
				var c = db[collectionName].find().limit(3);
				while (await c.hasNext()) {
					await c.next();
					count++;
				}
				if (count!=3) throw "should only have max 3 when limited";
			});

			it('should testMap', async function() {
				var i = 0;
				var numDocs = 0;
				var result = await db[collectionName].find().map(function(doc) {
					return i++;
				});
				if (result.length!=6) throw "result should have entry for each doc";
				if (result[2]!=2) throw "result array not correct";
			});

			it('should testNext', async function() {
				var c = db[collectionName].find();
				while (await c.hasNext()) {
					await c.next();
				}
			});

			it('should testSkip', async function() {
				var count = 0;
				var c = db[collectionName].find().skip(3);
				while (await c.hasNext()) {
					await c.next();
					count++;
				}
				if (count!=3) throw "should have skipped 3 and return 3";
			});

			it('should testSort', async function() {
				var prev = 0;
				var c = db[collectionName].find({legs:{$gt:1}}).sort({legs:1});
				while (await c.hasNext()) {
					var curr = (await c.next()).legs;
					if (curr<prev) throw "should be >= than previous";
					prev = curr;
				}
				prev = 1000;
				var c = db[collectionName].find({legs:{$gt:1}}).sort({legs:-1});
				while (await c.hasNext()) {
					var curr = (await c.next()).legs;
					if (curr>prev) throw "should be <= than previous";
					prev = curr;
				}
			});

			it('should testToArray', async function() {
				var c = db[collectionName].find();
				await c.next();
				await c.next();
				var arr = await c.toArray();
				if (arr.length!=4) throw "should be 4 elements in results array";
			});

			it('should testSortCount', async function() {
				var c = db[collectionName].find().sort({legs:1});
				if (await c.count() != 6) throw "incorrect count";
				while (await c.hasNext()) {
					await c.next();
					if (await c.count() != 6) throw "incorrect count";
				}
			});

			it('should testSortForEach', async function() {
				var numLegs = 0;
				var numDocs = 0;
				await db[collectionName].find().sort({legs:-1}).forEach(function(doc) {
					numDocs++;
					if (doc.legs) numLegs += doc.legs;
				});
				if (numDocs!=6) throw "total number of docs != 6";
				if (numLegs!=19) throw "total number of legs != 19"; 
			});
				
			it('should testSortHasNext', async function() {
				var c = db[collectionName].find().sort({legs:1});
				while (await c.hasNext()) {
					await c.next();
				}
			});

			it('should testSortLimit', async function() {
				var count = 0;
				var c = await db[collectionName].find().sort({legs:1}).limit(3);
				while (await c.hasNext()) {
					await c.next();
					count++;
				}
				if (count!=3) throw "should only have max 3 when limited";
			});
				
			it('should testSortMap', async function() {
				var i = 0;
				var numDocs = 0;
				var result = await db[collectionName].find().sort({legs:1}).map(function(doc) {
					return i++;
				});
				if (result.length!=6) throw "result should have entry for each doc";
				if (result[2]!=2) throw "result array not correct";
			});
				
			it('should testSortNext', async function() {
				var c = db[collectionName].find().sort({legs:1});
				while (await c.hasNext()) {
					await c.next();
				}
			});
				
			it('should testSortSkip', async function() {
				var count = 0;
				var c = await db[collectionName].find().sort({legs:1}).skip(3);
				while (await c.hasNext()) {
					await c.next();
					count++;
				}
				if (count!=3) throw "should have skipped 3 and return 3";
			});

			it('should testSortSort', async function() {
				var prev = 0;
				var c = db[collectionName].find({legs:{$gt:1}}).sort({legs:-1}).sort({legs:1});
				while (await c.hasNext()) {
					var curr = (await c.next()).legs;
					if (curr<prev) throw "should be >= than previous";
					prev = curr;
				}
				prev = 1000;
				var c = db[collectionName].find({legs:{$gt:1}}).sort({legs:1}).sort({legs:-1});
				while (await c.hasNext()) {
					var curr = (await c.next()).legs;
					if (curr>prev) throw "should be <= than previous";
					prev = curr;
				}
			});

			it('should testSortToArray', async function() {
				var c = db[collectionName].find().sort({legs:1});
				await c.next();
				await c.next();
				var arr = await c.toArray();
				if (arr.length!=4) throw "should be 4 elements in results array";
			});
		});

		describe("Indexes", function() {
			
			it('should create a single-field index', async function() {
				var indexName = await db[collectionName].createIndex({ age: 1 });
				expect(indexName).to.equal('age_1');
				var indexes = await db[collectionName].getIndexes();
				expect(indexes.length).to.equal(1);
				expect(indexes[0].name).to.equal('age_1');
				expect(indexes[0].key).to.deep.equal({ age: 1 });
			});

			it('should create a named index', async function() {
				var indexName = await db[collectionName].createIndex({ legs: 1 }, { name: 'legs_index' });
				expect(indexName).to.equal('legs_index');
				var indexes = await db[collectionName].getIndexes();
				expect(indexes.length).to.equal(1);
				expect(indexes[0].name).to.equal('legs_index');
			});

			it('should create multiple indexes', async function() {
				await db[collectionName].createIndex({ age: 1 });
				await db[collectionName].createIndex({ legs: -1 });
				var indexes = await db[collectionName].getIndexes();
				expect(indexes.length).to.equal(2);
			});

			it('should not create duplicate index', async function() {
				await db[collectionName].createIndex({ age: 1 });
				await db[collectionName].createIndex({ age: 1 });
				var indexes = await db[collectionName].getIndexes();
				expect(indexes.length).to.equal(1);
			});

			it('should throw error when creating index with conflicting name', async function() {
				await db[collectionName].createIndex({ age: 1 }, { name: 'my_index' });
				try {
					await db[collectionName].createIndex({ legs: 1 }, { name: 'my_index' });
					throw new Error('Should have thrown an error');
				} catch(e) {
					expect(e.code).to.equal(85);
				}
			});

			it('should throw error when keys is an array', async function() {
				try {
					await db[collectionName].createIndex([{ age: 1 }]);
					throw new Error('Should have thrown an error');
				} catch(e) {
					expect(e.code).to.equal(2);
				}
			});

			it('should use index for simple equality query', async function() {
				// Create index on age field
				await db[collectionName].createIndex({ age: 1 });
				
				// Query using indexed field
				var results = await db[collectionName].find({ age: 54 }).toArray();
				expect(results.length).to.equal(2);
				
				// Verify we got the right documents
				results.forEach(function(doc) {
					expect(doc.age).to.equal(54);
				});
			});

			it('should still work with non-indexed queries', async function() {
				// Create index on age field
				await db[collectionName].createIndex({ age: 1 });
				
				// Query using non-indexed field
				var results = await db[collectionName].find({ legs: 5 }).toArray();
				expect(results.length).to.equal(1);
				expect(results[0].legs).to.equal(5);
			});

			it('should maintain index on insert', async function() {
				await db[collectionName].createIndex({ age: 1 });
				
				// Insert a new document
				await db[collectionName].insertOne({ age: 25, legs: 2 });
				
				// Query should find the new document
				var results = await db[collectionName].find({ age: 25 }).toArray();
				expect(results.length).to.equal(1);
				expect(results[0].age).to.equal(25);
			});

			it('should maintain index on delete', async function() {
				await db[collectionName].createIndex({ age: 1 });
				
				// Delete documents with age 54
				var deleteResult = await db[collectionName].deleteMany({ age: 54 });
				expect(deleteResult.deletedCount).to.equal(2);
				
				// Query should not find deleted documents
				var results = await db[collectionName].find({ age: 54 }).toArray();
				expect(results.length).to.equal(0);
			});

			it('should handle complex queries with index', async function() {
				await db[collectionName].createIndex({ age: 1 });
				
				// Complex query with indexed and non-indexed fields
				var results = await db[collectionName].find({ age: 4, legs: 5 }).toArray();
				expect(results.length).to.equal(1);
				expect(results[0].age).to.equal(4);
				expect(results[0].legs).to.equal(5);
			});

			it('should handle queries with operators on indexed fields', async function() {
				await db[collectionName].createIndex({ age: 1 });
				
				// Query with operators falls back to full scan
				var results = await db[collectionName].find({ age: { $gt: 50 } }).toArray();
				expect(results.length).to.equal(2);
			});

			it('should create compound index', async function() {
				var indexName = await db[collectionName].createIndex({ age: 1, legs: 1 });
				expect(indexName).to.equal('age_1_legs_1');
				
				var indexes = await db[collectionName].getIndexes();
				expect(indexes.length).to.equal(1);
				expect(indexes[0].key).to.deep.equal({ age: 1, legs: 1 });
			});

			it('should handle empty result set with index', async function() {
				await db[collectionName].createIndex({ age: 1 });
				
				// Query for non-existent value
				var results = await db[collectionName].find({ age: 999 }).toArray();
				expect(results.length).to.equal(0);
			});

			it('should maintain index on update', async function() {
				await db[collectionName].createIndex({ age: 1 });
				
				// Update a document's age
				await db[collectionName].updateOne({ age: 54 }, { $set: { age: 55 } });
				
				// Old value should not be found
				var oldResults = await db[collectionName].find({ age: 54 }).toArray();
				expect(oldResults.length).to.equal(1); // Only one doc with age 54 left
				
				// New value should be found
				var newResults = await db[collectionName].find({ age: 55 }).toArray();
				expect(newResults.length).to.equal(1);
				expect(newResults[0].age).to.equal(55);
			});

			it('should maintain index on replaceOne', async function() {
				await db[collectionName].createIndex({ age: 1 });
				
				// Replace a document
				await db[collectionName].replaceOne({ age: 16 }, { age: 17, legs: 4 });
				
				// Old value should not be found
				var oldResults = await db[collectionName].find({ age: 16 }).toArray();
				expect(oldResults.length).to.equal(0);
				
				// New value should be found
				var newResults = await db[collectionName].find({ age: 17 }).toArray();
				expect(newResults.length).to.equal(1);
				expect(newResults[0].legs).to.equal(4);
			});

			it('should maintain index on remove', async function() {
				await db[collectionName].createIndex({ age: 1 });
				
				// Remove one document
				await db[collectionName].remove({ age: 4 }, true);
				
				// Should have one less document with age 4
				var results = await db[collectionName].find({ age: 4 }).toArray();
				expect(results.length).to.equal(1);
			});
		});

		describe("Text Indexes", function() {
			const textCollectionName = "textTestCollection";

			beforeEach(async function() {
				db.createCollection(textCollectionName);
			});

			afterEach(async function() {
				await db.dropDatabase();
			});

			it('should create a text index', async function() {
				await db[textCollectionName].insertMany([
					{ title: 'MongoDB Tutorial', description: 'Learn MongoDB basics' },
					{ title: 'Node.js Guide', description: 'JavaScript on the server' },
					{ title: 'Database Design', description: 'How to design databases' }
				]);

				const indexName = await db[textCollectionName].createIndex({ description: 'text' });
				expect(indexName).to.equal('description_text');

				const indexes = await db[textCollectionName].getIndexes();
				expect(indexes.length).to.equal(1);
				expect(indexes[0].name).to.equal('description_text');
				expect(indexes[0].key).to.deep.equal({ description: 'text' });
			});

			it('should create a named text index', async function() {
				const indexName = await db[textCollectionName].createIndex(
					{ title: 'text' }, 
					{ name: 'title_search' }
				);
				expect(indexName).to.equal('title_search');

				const indexes = await db[textCollectionName].getIndexes();
				expect(indexes.length).to.equal(1);
				expect(indexes[0].name).to.equal('title_search');
			});

			it('should create compound text index on multiple fields', async function() {
				const indexName = await db[textCollectionName].createIndex({ 
					title: 'text', 
					description: 'text' 
				});
				expect(indexName).to.equal('title_text_description_text');

				const indexes = await db[textCollectionName].getIndexes();
				expect(indexes.length).to.equal(1);
				expect(indexes[0].key).to.deep.equal({ title: 'text', description: 'text' });
			});

			it('should maintain text index on insert', async function() {
				await db[textCollectionName].createIndex({ content: 'text' });
				
				// Insert a document
				await db[textCollectionName].insertOne({ 
					content: 'The quick brown fox jumps over the lazy dog' 
				});

				// The index should be updated automatically
				const docs = await db[textCollectionName].find({ 
					content: { $text: 'fox' } 
				}).toArray();
				expect(docs.length).to.equal(1);
			});

			it('should maintain text index on update', async function() {
				await db[textCollectionName].insertOne({ 
					_id: 'doc1',
					content: 'original text' 
				});
				await db[textCollectionName].createIndex({ content: 'text' });

				// Document should be found with original text
				let docs = await db[textCollectionName].find({ 
					content: { $text: 'original' } 
				}).toArray();
				expect(docs.length).to.equal(1);

				// Update the document
				await db[textCollectionName].updateOne(
					{ _id: 'doc1' },
					{ $set: { content: 'updated text' } }
				);

				// Should not find with old text
				docs = await db[textCollectionName].find({ 
					content: { $text: 'original' } 
				}).toArray();
				expect(docs.length).to.equal(0);

				// Should find with new text
				docs = await db[textCollectionName].find({ 
					content: { $text: 'updated' } 
				}).toArray();
				expect(docs.length).to.equal(1);
			});

			it('should maintain text index on delete', async function() {
				await db[textCollectionName].insertMany([
					{ _id: 'doc1', content: 'first document' },
					{ _id: 'doc2', content: 'second document' }
				]);
				await db[textCollectionName].createIndex({ content: 'text' });

				// Both documents should be found
				let docs = await db[textCollectionName].find({ 
					content: { $text: 'document' } 
				}).toArray();
				expect(docs.length).to.equal(2);

				// Delete one document
				await db[textCollectionName].deleteOne({ _id: 'doc1' });

				// Should only find one document
				docs = await db[textCollectionName].find({ 
					content: { $text: 'document' } 
				}).toArray();
				expect(docs.length).to.equal(1);
				expect(docs[0]._id).to.equal('doc2');
			});

			it('should drop a text index', async function() {
				await db[textCollectionName].createIndex({ content: 'text' });
				
				let indexes = await db[textCollectionName].getIndexes();
				expect(indexes.length).to.equal(1);

				// Drop the index
				const result = await db[textCollectionName].dropIndex('content_text');
				expect(result.ok).to.equal(1);

				indexes = await db[textCollectionName].getIndexes();
				expect(indexes.length).to.equal(0);
			});

			it('should drop all indexes', async function() {
				await db[textCollectionName].createIndex({ title: 'text' });
				await db[textCollectionName].createIndex({ description: 'text' });
				await db[textCollectionName].createIndex({ author: 1 }); // Regular index
				
				let indexes = await db[textCollectionName].getIndexes();
				expect(indexes.length).to.equal(3);

				// Drop all indexes
				const result = await db[textCollectionName].dropIndexes();
				expect(result.ok).to.equal(1);

				indexes = await db[textCollectionName].getIndexes();
				expect(indexes.length).to.equal(0);
			});

			it('should find documents using text search', async function() {
				await db[textCollectionName].insertMany([
					{ title: 'JavaScript Basics', content: 'Learn JavaScript programming' },
					{ title: 'Python Tutorial', content: 'Learn Python programming' },
					{ title: 'Database Design', content: 'Design principles for databases' }
				]);
				await db[textCollectionName].createIndex({ content: 'text' });

				// Search for "programming"
				const docs = await db[textCollectionName].find({ 
					content: { $text: 'programming' } 
				}).toArray();
				expect(docs.length).to.equal(2);
				
				const titles = docs.map(d => d.title).sort();
				expect(titles).to.deep.equal(['JavaScript Basics', 'Python Tutorial']);
			});

			it('should handle stemming in text search', async function() {
				await db[textCollectionName].insertMany([
					{ text: 'I am running fast' },
					{ text: 'He runs every day' },
					{ text: 'We like to run' }
				]);
				await db[textCollectionName].createIndex({ text: 'text' });

				// All should match because of stemming (running, runs, run all stem to "run")
				const docs = await db[textCollectionName].find({ 
					text: { $text: 'run' } 
				}).toArray();
				expect(docs.length).to.equal(3);
			});

			it('should support $and queries with text search', async function() {
				await db[textCollectionName].insertMany([
					{ content: 'JavaScript and Python programming' },
					{ content: 'JavaScript tutorial for beginners' },
					{ content: 'Python programming guide' }
				]);
				await db[textCollectionName].createIndex({ content: 'text' });

				// Find documents with both "JavaScript" and "programming"
				const docs = await db[textCollectionName].find({ 
					$and: [
						{ content: { $text: 'JavaScript' } },
						{ content: { $text: 'programming' } }
					]
				}).toArray();
				expect(docs.length).to.equal(1);
				expect(docs[0].content).to.include('JavaScript and Python programming');
			});

			it('should handle empty text field gracefully', async function() {
				await db[textCollectionName].insertMany([
					{ content: '' },
					{ content: 'some text' },
					{ content: null }
				]);
				await db[textCollectionName].createIndex({ content: 'text' });

				const docs = await db[textCollectionName].find({ 
					content: { $text: 'text' } 
				}).toArray();
				expect(docs.length).to.equal(1);
				expect(docs[0].content).to.equal('some text');
			});

			it('should support top-level $text operator', async function() {
				await db[textCollectionName].insertMany([
					{ title: 'JavaScript Tutorial', body: 'Learn JavaScript programming' },
					{ title: 'Python Guide', body: 'Python programming basics' },
					{ title: 'Database Design', body: 'Design principles for databases' }
				]);
				await db[textCollectionName].createIndex({ body: 'text' });

				// Top-level $text searches across all text-indexed fields
				const docs = await db[textCollectionName].find({ 
					$text: { $search: 'programming' } 
				}).toArray();
				expect(docs.length).to.equal(2);
				
				const titles = docs.map(d => d.title).sort();
				expect(titles).to.deep.equal(['JavaScript Tutorial', 'Python Guide']);
			});
		});

		describe("Geospatial Indexes", function() {
			const geoCollectionName = "geoTestCollection";

			beforeEach(async function() {
				db.createCollection(geoCollectionName);
			});

			afterEach(async function() {
				await db.dropDatabase();
			});

			it('should create a 2dsphere index', async function() {
				const indexName = await db[geoCollectionName].createIndex({ location: '2dsphere' });
				expect(indexName).to.equal('location_2dsphere');

				const indexes = await db[geoCollectionName].getIndexes();
				expect(indexes.length).to.equal(1);
				expect(indexes[0].name).to.equal('location_2dsphere');
				expect(indexes[0].key).to.deep.equal({ location: '2dsphere' });
			});

			it('should create a named geospatial index', async function() {
				const indexName = await db[geoCollectionName].createIndex(
					{ position: '2dsphere' }, 
					{ name: 'geo_index' }
				);
				expect(indexName).to.equal('geo_index');

				const indexes = await db[geoCollectionName].getIndexes();
				expect(indexes.length).to.equal(1);
				expect(indexes[0].name).to.equal('geo_index');
			});

			it('should maintain geospatial index on insert', async function() {
				await db[geoCollectionName].createIndex({ location: '2dsphere' });
				
				// Insert documents with GeoJSON points
				await db[geoCollectionName].insertMany([
					{ 
						name: 'Location A',
						location: { type: 'Point', coordinates: [10, 20] }
					},
					{ 
						name: 'Location B',
						location: { type: 'Point', coordinates: [30, 40] }
					}
				]);

				// Query with $geoWithin
				const docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[5, 25], [35, 15]] }
				}).toArray();
				expect(docs.length).to.equal(1);
				expect(docs[0].name).to.equal('Location A');
			});

			it('should use geospatial index for $geoWithin queries', async function() {
				// Insert test documents
				await db[geoCollectionName].insertMany([
					{ name: 'NYC', location: { type: 'Point', coordinates: [-74.0060, 40.7128] } },
					{ name: 'SF', location: { type: 'Point', coordinates: [-122.4194, 37.7749] } },
					{ name: 'LA', location: { type: 'Point', coordinates: [-118.2437, 34.0522] } }
				]);

				// Create geospatial index
				await db[geoCollectionName].createIndex({ location: '2dsphere' });

				// Query for locations on the east coast (roughly)
				const eastCoastBBox = [[-80, 45], [-70, 35]]; // [topLeft, bottomRight]
				const docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: eastCoastBBox }
				}).toArray();

				expect(docs.length).to.equal(1);
				expect(docs[0].name).to.equal('NYC');
			});

			it('should maintain geospatial index on update', async function() {
				const docId = new mongo.ObjectId();
				await db[geoCollectionName].insertOne({ 
					_id: docId,
					location: { type: 'Point', coordinates: [10, 20] }
				});
				await db[geoCollectionName].createIndex({ location: '2dsphere' });

				// Should find with original location
				let docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[5, 25], [15, 15]] }
				}).toArray();
				expect(docs.length).to.equal(1);

				// Update the location
				await db[geoCollectionName].updateOne(
					{ _id: docId },
					{ $set: { location: { type: 'Point', coordinates: [100, 200] } } }
				);

				// Should not find with old location
				docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[5, 25], [15, 15]] }
				}).toArray();
				expect(docs.length).to.equal(0);

				// Should find with new location
				docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[95, 205], [105, 195]] }
				}).toArray();
				expect(docs.length).to.equal(1);
			});

			it('should maintain geospatial index on delete', async function() {
				const loc1 = new mongo.ObjectId();
				const loc2 = new mongo.ObjectId();
				await db[geoCollectionName].insertMany([
					{ _id: loc1, location: { type: 'Point', coordinates: [10, 20] } },
					{ _id: loc2, location: { type: 'Point', coordinates: [11, 21] } }
				]);
				await db[geoCollectionName].createIndex({ location: '2dsphere' });

				// Both should be found
				let docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[5, 25], [15, 15]] }
				}).toArray();
				expect(docs.length).to.equal(2);

				// Delete one location
				await db[geoCollectionName].deleteOne({ _id: loc1 });

				// Should only find one
				docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[5, 25], [15, 15]] }
				}).toArray();
				expect(docs.length).to.equal(1);
				expect(docs[0]._id).to.deep.equal(loc2);
			});

			it('should drop a geospatial index', async function() {
				await db[geoCollectionName].createIndex({ location: '2dsphere' });
				
				let indexes = await db[geoCollectionName].getIndexes();
				expect(indexes.length).to.equal(1);

				// Drop the index
				const result = await db[geoCollectionName].dropIndex('location_2dsphere');
				expect(result.ok).to.equal(1);

				indexes = await db[geoCollectionName].getIndexes();
				expect(indexes.length).to.equal(0);
			});

			it('should handle GeoJSON FeatureCollection', async function() {
				await db[geoCollectionName].insertOne({
					name: 'Test Feature',
					location: {
						type: 'FeatureCollection',
						features: [{
							type: 'Feature',
							geometry: { type: 'Point', coordinates: [10, 20] }
						}]
					}
				});
				await db[geoCollectionName].createIndex({ location: '2dsphere' });

				const docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[5, 25], [15, 15]] }
				}).toArray();
				expect(docs.length).to.equal(1);
				expect(docs[0].name).to.equal('Test Feature');
			});

			it('should handle GeoJSON Polygon', async function() {
				await db[geoCollectionName].insertOne({
					name: 'Polygon Area',
					location: {
						type: 'Polygon',
						coordinates: [[
							[10, 20],
							[11, 20],
							[11, 21],
							[10, 21],
							[10, 20]
						]]
					}
				});
				await db[geoCollectionName].createIndex({ location: '2dsphere' });

				// Polygon should be found when all vertices are within bbox
				const docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[9, 22], [12, 19]] }
				}).toArray();
				expect(docs.length).to.equal(1);
				expect(docs[0].name).to.equal('Polygon Area');
			});

			it('should not find polygon partially outside bbox', async function() {
				await db[geoCollectionName].insertOne({
					name: 'Partial Polygon',
					location: {
						type: 'Polygon',
						coordinates: [[
							[10, 20],
							[15, 20],  // This extends outside
							[15, 25],
							[10, 25],
							[10, 20]
						]]
					}
				});
				await db[geoCollectionName].createIndex({ location: '2dsphere' });

				// Polygon should NOT be found when vertices extend outside bbox
				const docs = await db[geoCollectionName].find({ 
					location: { $geoWithin: [[9, 26], [12, 19]] }  // Max lng is 12, but polygon goes to 15
				}).toArray();
				expect(docs.length).to.equal(0);
			});
		});

		describe('$near operator', function() {
			const nearCollectionName = 'nearTestCollection';

			beforeEach(async function() {
				if (db[nearCollectionName]) {
					await db[nearCollectionName].drop();
				}
			});

			afterEach(async function() {
				if (db[nearCollectionName]) {
					await db[nearCollectionName].drop();
				}
			});

			it('should find points within maxDistance using $near', async function() {
				// Insert test locations
				await db[nearCollectionName].insertMany([
					{ name: 'NYC', location: { type: 'Point', coordinates: [-74.0060, 40.7128] } },
					{ name: 'Philadelphia', location: { type: 'Point', coordinates: [-75.1652, 39.9526] } },
					{ name: 'Boston', location: { type: 'Point', coordinates: [-71.0589, 42.3601] } },
					{ name: 'LA', location: { type: 'Point', coordinates: [-118.2437, 34.0522] } }
				]);

				await db[nearCollectionName].createIndex({ location: '2dsphere' });

				// Find points near NYC within 500km
				const docs = await db[nearCollectionName].find({
					location: {
						$near: {
							$geometry: { type: 'Point', coordinates: [-74.0060, 40.7128] },
							$maxDistance: 500000 // 500km in meters
						}
					}
				}).toArray();

				// Should find NYC, Philadelphia, and Boston (all within 500km)
				// Should NOT find LA (too far away)
				expect(docs.length).to.equal(3);
				
				// Results should be sorted by distance
				expect(docs[0].name).to.equal('NYC'); // Closest (0km)
				expect(docs[1].name).to.equal('Philadelphia'); // ~130km
				expect(docs[2].name).to.equal('Boston'); // ~300km
			});

			it('should return results sorted by distance with $near', async function() {
				await db[nearCollectionName].insertMany([
					{ name: 'Point A', location: { type: 'Point', coordinates: [0, 0] } },
					{ name: 'Point B', location: { type: 'Point', coordinates: [1, 1] } },
					{ name: 'Point C', location: { type: 'Point', coordinates: [0.5, 0.5] } }
				]);

				await db[nearCollectionName].createIndex({ location: '2dsphere' });

				const docs = await db[nearCollectionName].find({
					location: {
						$near: {
							$geometry: { type: 'Point', coordinates: [0, 0] },
							$maxDistance: 200000 // 200km
						}
					}
				}).toArray();

				// Should be sorted by distance from [0,0]
				expect(docs.length).to.equal(3);
				expect(docs[0].name).to.equal('Point A'); // At origin
				expect(docs[1].name).to.equal('Point C'); // Closer to origin
				expect(docs[2].name).to.equal('Point B'); // Furthest from origin
			});

			it('should handle $near with alternative coordinate format', async function() {
				await db[nearCollectionName].insertOne({
					name: 'Test Location',
					location: { type: 'Point', coordinates: [10, 20] }
				});

				await db[nearCollectionName].createIndex({ location: '2dsphere' });

				// Test with direct coordinates array
				const docs = await db[nearCollectionName].find({
					location: {
						$near: {
							coordinates: [10, 20],
							$maxDistance: 1000 // 1km
						}
					}
				}).toArray();

				expect(docs.length).to.equal(1);
				expect(docs[0].name).to.equal('Test Location');
			});

			it('should return empty array when no points within maxDistance', async function() {
				await db[nearCollectionName].insertMany([
					{ name: 'Far Point 1', location: { type: 'Point', coordinates: [100, 50] } },
					{ name: 'Far Point 2', location: { type: 'Point', coordinates: [110, 60] } }
				]);

				await db[nearCollectionName].createIndex({ location: '2dsphere' });

				const docs = await db[nearCollectionName].find({
					location: {
						$near: {
							$geometry: { type: 'Point', coordinates: [0, 0] },
							$maxDistance: 1000 // 1km - too small
						}
					}
				}).toArray();

				expect(docs.length).to.equal(0);
			});
		});

		describe('$nearSphere operator', function() {
			const nearSphereCollectionName = 'nearSphereTestCollection';

			beforeEach(async function() {
				if (db[nearSphereCollectionName]) {
					await db[nearSphereCollectionName].drop();
				}
			});

			afterEach(async function() {
				if (db[nearSphereCollectionName]) {
					await db[nearSphereCollectionName].drop();
				}
			});

			it('should find points within maxDistance using $nearSphere', async function() {
				await db[nearSphereCollectionName].insertMany([
					{ name: 'London', location: { type: 'Point', coordinates: [-0.1278, 51.5074] } },
					{ name: 'Paris', location: { type: 'Point', coordinates: [2.3522, 48.8566] } },
					{ name: 'Berlin', location: { type: 'Point', coordinates: [13.4050, 52.5200] } },
					{ name: 'Tokyo', location: { type: 'Point', coordinates: [139.6917, 35.6895] } }
				]);

				await db[nearSphereCollectionName].createIndex({ location: '2dsphere' });

				// Find points near London within 1500km
				const docs = await db[nearSphereCollectionName].find({
					location: {
						$nearSphere: {
							$geometry: { type: 'Point', coordinates: [-0.1278, 51.5074] },
							$maxDistance: 1500000 // 1500km in meters
						}
					}
				}).toArray();

				// Should find London, Paris, and Berlin (all within 1500km)
				// Should NOT find Tokyo (too far)
				expect(docs.length).to.equal(3);
				expect(docs[0].name).to.equal('London'); // Closest
				expect(docs[1].name).to.equal('Paris'); // ~340km
				expect(docs[2].name).to.equal('Berlin'); // ~930km
			});

			it('should return results sorted by spherical distance', async function() {
				await db[nearSphereCollectionName].insertMany([
					{ name: 'A', location: { type: 'Point', coordinates: [0, 0] } },
					{ name: 'B', location: { type: 'Point', coordinates: [2, 2] } },
					{ name: 'C', location: { type: 'Point', coordinates: [1, 1] } }
				]);

				await db[nearSphereCollectionName].createIndex({ location: '2dsphere' });

				const docs = await db[nearSphereCollectionName].find({
					location: {
						$nearSphere: {
							$geometry: { type: 'Point', coordinates: [0, 0] },
							$maxDistance: 500000
						}
					}
				}).toArray();

				expect(docs.length).to.equal(3);
				expect(docs[0].name).to.equal('A');
				expect(docs[1].name).to.equal('C');
				expect(docs[2].name).to.equal('B');
			});

			it('should handle $nearSphere with default maxDistance', async function() {
				await db[nearSphereCollectionName].insertOne({
					name: 'Test Point',
					location: { type: 'Point', coordinates: [10, 20] }
				});

				await db[nearSphereCollectionName].createIndex({ location: '2dsphere' });

				// Without specifying maxDistance, should use default (1000km)
				const docs = await db[nearSphereCollectionName].find({
					location: {
						$nearSphere: {
							$geometry: { type: 'Point', coordinates: [10.1, 20.1] }
						}
					}
				}).toArray();

				expect(docs.length).to.equal(1);
				expect(docs[0].name).to.equal('Test Point');
			});
		});

		describe('$geoIntersects operator', function() {
			const intersectsCollectionName = 'intersectsTestCollection';

			beforeEach(async function() {
				if (db[intersectsCollectionName]) {
					await db[intersectsCollectionName].drop();
				}
			});

			afterEach(async function() {
				if (db[intersectsCollectionName]) {
					await db[intersectsCollectionName].drop();
				}
			});

			it('should find points that intersect with a Point geometry', async function() {
				await db[intersectsCollectionName].insertMany([
					{ name: 'Point A', location: { type: 'Point', coordinates: [10, 20] } },
					{ name: 'Point B', location: { type: 'Point', coordinates: [15, 25] } },
					{ name: 'Point C', location: { type: 'Point', coordinates: [10.0001, 20.0001] } }
				]);

				await db[intersectsCollectionName].createIndex({ location: '2dsphere' });

				// Find points that intersect with a specific point
				const docs = await db[intersectsCollectionName].find({
					location: {
						$geoIntersects: {
							$geometry: { type: 'Point', coordinates: [10, 20] }
						}
					}
				}).toArray();

				// Should find Point A and Point C (very close to the query point)
				expect(docs.length).to.be.at.least(1);
				const names = docs.map(d => d.name);
				expect(names).to.include('Point A');
			});

			it('should find points inside a Polygon using $geoIntersects', async function() {
				await db[intersectsCollectionName].insertMany([
					{ name: 'Inside Point 1', location: { type: 'Point', coordinates: [10, 20] } },
					{ name: 'Inside Point 2', location: { type: 'Point', coordinates: [11, 21] } },
					{ name: 'Outside Point', location: { type: 'Point', coordinates: [50, 50] } }
				]);

				await db[intersectsCollectionName].createIndex({ location: '2dsphere' });

				// Define a polygon that contains the first two points
				const polygon = {
					type: 'Polygon',
					coordinates: [[
						[9, 19],
						[12, 19],
						[12, 22],
						[9, 22],
						[9, 19]
					]]
				};

				const docs = await db[intersectsCollectionName].find({
					location: {
						$geoIntersects: {
							$geometry: polygon
						}
					}
				}).toArray();

				expect(docs.length).to.equal(2);
				const names = docs.map(d => d.name);
				expect(names).to.include('Inside Point 1');
				expect(names).to.include('Inside Point 2');
				expect(names).to.not.include('Outside Point');
			});

			it('should handle complex polygon shapes', async function() {
				await db[intersectsCollectionName].insertMany([
					{ name: 'Center', location: { type: 'Point', coordinates: [0, 0] } },
					{ name: 'Corner', location: { type: 'Point', coordinates: [5, 5] } },
					{ name: 'Outside', location: { type: 'Point', coordinates: [10, 10] } }
				]);

				await db[intersectsCollectionName].createIndex({ location: '2dsphere' });

				// L-shaped polygon
				const lShapedPolygon = {
					type: 'Polygon',
					coordinates: [[
						[-2, -2],
						[6, -2],
						[6, 2],
						[2, 2],
						[2, 6],
						[-2, 6],
						[-2, -2]
					]]
				};

				const docs = await db[intersectsCollectionName].find({
					location: {
						$geoIntersects: {
							$geometry: lShapedPolygon
						}
					}
				}).toArray();

				expect(docs.length).to.be.at.least(1);
				const names = docs.map(d => d.name);
				expect(names).to.include('Center');
			});

			it('should return empty array when no points intersect', async function() {
				await db[intersectsCollectionName].insertMany([
					{ name: 'Far Point 1', location: { type: 'Point', coordinates: [100, 100] } },
					{ name: 'Far Point 2', location: { type: 'Point', coordinates: [110, 110] } }
				]);

				await db[intersectsCollectionName].createIndex({ location: '2dsphere' });

				const smallPolygon = {
					type: 'Polygon',
					coordinates: [[
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 1],
						[0, 0]
					]]
				};

				const docs = await db[intersectsCollectionName].find({
					location: {
						$geoIntersects: {
							$geometry: smallPolygon
						}
					}
				}).toArray();

				expect(docs.length).to.equal(0);
			});

			it('should handle point on polygon boundary', async function() {
				await db[intersectsCollectionName].insertOne({
					name: 'Boundary Point',
					location: { type: 'Point', coordinates: [10, 20] }
				});

				await db[intersectsCollectionName].createIndex({ location: '2dsphere' });

				// Polygon with point on edge
				const polygon = {
					type: 'Polygon',
					coordinates: [[
						[10, 20],
						[15, 20],
						[15, 25],
						[10, 25],
						[10, 20]
					]]
				};

				const docs = await db[intersectsCollectionName].find({
					location: {
						$geoIntersects: {
							$geometry: polygon
						}
					}
				}).toArray();

				// Point on boundary should be found
				expect(docs.length).to.equal(1);
				expect(docs[0].name).to.equal('Boundary Point');
			});
		});
	});
});
