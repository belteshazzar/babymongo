# BabyMongo

A JavaScript implementation of the MongoDB query API with persistent storage using the Origin Private File System (OPFS). BabyMongo runs database operations in a Web Worker (browser) or Worker Thread (Node.js).

**Key Features:**
- 🔄 **MongoDB-Compatible API:** Familiar MongoDB syntax for queries, updates, aggregations, and change streams
- 💾 **OPFS Persistent Storage:** Automatic persistence using the Origin Private File System (browser) with a Node.js polyfill for development
- 📦 **Zero Configuration:** Works out of the box in both browser and Node.js environments
- 🚀 **Web Worker Architecture:** Database operations run in a separate thread, keeping your UI responsive
- 🔍 **Advanced Features:** Indexes, text search, geospatial queries, aggregation pipelines, and real-time change streams

[![Tests](https://github.com/belteshazzar/babymongo/actions/workflows/test.yml/badge.svg)](https://github.com/belteshazzar/babymongo/actions/workflows/test.yml) [![codecov](https://codecov.io/gh/belteshazzar/babymongo/branch/master/graph/badge.svg)](https://codecov.io/gh/belteshazzar/babymongo)

## In Node.js

### Installation

  `npm install babymongo`

### Usage

BabyMongo uses a web worker architecture to keep database operations off the main thread. The `WorkerBridge` manages communication between your application and the database worker:

```javascript
import { MongoClient, WorkerBridge } from 'babymongo';

async function main() {
    // Step 1: Create the worker bridge
    const bridge = await WorkerBridge.create();
    
    // Step 2: Connect to database with the bridge
    const client = new MongoClient('mongodb://localhost:27017/myapp', { 
        workerBridge: bridge 
    });
    await client.connect();
    
    const db = client.db('myapp');
    
    // Insert documents (async)
    await db.sample.insertOne({ age: 4, legs: 0 });
    await db.sample.insertMany([
        { age: 4, legs: 5 },
        { age: 54, legs: 2 }
    ]);
    
    // Query documents with toArray() (async)
    const results = await db.sample.find({ age: 54 }).toArray();
    console.log(results);
    
    // Or use async iteration
    for await (const doc of db.sample.find({ legs: 2 })) {
        console.log(doc);
    }
    
    // Update (async)
    await db.sample.updateOne({ age: 4 }, { $set: { legs: 4 } });
    
    // Delete (async)
    await db.sample.deleteOne({ age: 54 });
    
    // Count (async)
    const count = await db.sample.count();
    console.log(`Total documents: ${count}`);
    
    // Close connection
    await client.close();
}

main().catch(console.error);
```

**Why Web Workers?**
- ✅ Non-blocking operations keep your UI responsive
- ✅ Efficient isolation of database logic
- ✅ Better performance for large datasets
- ✅ Works seamlessly in both browser and Node.js
- ✅ Uses synchronous file access which is only available in Web Workers.

### Using Indexes

Indexes can significantly improve query performance for large collections:

```javascript
import { MongoClient, WorkerBridge } from 'babymongo';

async function main() {
    const bridge = await WorkerBridge.create();
    const client = new MongoClient('mongodb://localhost:27017/myapp', { 
        workerBridge: bridge 
    });
    await client.connect();
    const db = client.db('myapp');
    
    // Insert some data
    await db.users.insertMany([
        { name: "Alice", age: 30, city: "NYC" },
        { name: "Bob", age: 25, city: "LA" },
        { name: "Charlie", age: 30, city: "SF" }
    ]);
    
    // Create an index on the age field
    await db.users.createIndex({ age: 1 });
    
    // Create a named index on city
    await db.users.createIndex({ city: 1 }, { name: "city_index" });
    
    // Create a compound index
    await db.users.createIndex({ age: 1, city: 1 });
    
    // List all indexes
    const indexes = await db.users.getIndexes();
    
    // Queries will automatically use indexes when possible
    const results = await db.users.find({ age: 30 }).toArray();
    
    await client.close();
}

main().catch(console.error);
```

The query planner automatically uses indexes for simple equality queries. For complex queries, it combines index lookups with full collection scans to ensure complete and correct results.

### Persistent Storage with OPFS

BabyMongo uses the **Origin Private File System (OPFS)** for automatic data persistence. OPFS is a modern web standard that provides fast, private storage for web applications.

**In the Browser:**

Data is automatically persisted to the OPFS when you use the WorkerBridge pattern. No additional configuration needed!

```javascript
import { MongoClient, WorkerBridge } from 'babymongo';

async function main() {
    const bridge = await WorkerBridge.create();
    const client = new MongoClient('mongodb://localhost:27017/myapp', { 
        workerBridge: bridge 
    });
    await client.connect();
    const db = client.db('myapp');
    
    // Data is automatically persisted to OPFS
    await db.users.insertOne({ name: 'Alice', age: 30 });
    await db.users.createIndex({ age: 1 });
    
    // On page reload, your data and indexes are automatically restored!
    
    await client.close();
}

main().catch(console.error);
```

**In Node.js:**

BabyMongo includes the [node-opfs](https://github.com/belteshazzar/node-opfs) polyfill, which implements the OPFS API using the file system. Data is stored in a `.opfs` directory in your project root.

```javascript
// Same code works in Node.js!
import { MongoClient, WorkerBridge } from 'babymongo';

async function main() {
    const bridge = await WorkerBridge.create();
    const client = new MongoClient('mongodb://localhost:27017/myapp', { 
        workerBridge: bridge 
    });
    await client.connect();
    const db = client.db('myapp');
    
    // Data is persisted to .opfs/babymongo/myapp/
    await db.products.insertMany([
        { name: 'Widget', price: 10.99 },
        { name: 'Gadget', price: 24.99 }
    ]);
    
    await client.close();
}

main().catch(console.error);
```

**Storage Location:**
- **Browser:** Data stored in OPFS (private to your origin, not accessible via DevTools)
- **Node.js:** Data stored in `.opfs/babymongo/{database-name}/{collection-name}/` directory
- **Format:** Binary JSON (BJSON) with B+ tree indexing for efficient queries

**Benefits of OPFS:**
- ✅ **Fast:** Synchronous file access in workers for better performance
- ✅ **Private:** Data is isolated and secure
- ✅ **Automatic:** No manual save/load calls needed
- ✅ **Cross-platform:** Works identically in browser and Node.js (via polyfill)
- ✅ **Versioned:** Supports compaction and versioning to prevent data corruption

### Aggregation Pipelines

BabyMongo supports MongoDB's powerful aggregation framework for data transformation and analysis:

```javascript
import { MongoClient, WorkerBridge } from 'babymongo';

async function main() {
    const bridge = await WorkerBridge.create();
    const client = new MongoClient('mongodb://localhost:27017/myapp', {
        workerBridge: bridge
    });
    await client.connect();
    const db = client.db('myapp');
    
    // Sample data
    await db.sales.insertMany([
        { product: 'Widget', price: 10, quantity: 5, category: 'Tools' },
        { product: 'Gadget', price: 20, quantity: 3, category: 'Electronics' },
        { product: 'Doohickey', price: 15, quantity: 2, category: 'Tools' }
    ]);
    
    // Aggregation pipeline
    const results = await db.sales.aggregate([
        { $match: { category: 'Tools' } },
        { $addFields: { total: { $multiply: ['$price', '$quantity'] } } },
        { $group: { 
            _id: '$category', 
            totalSales: { $sum: '$total' },
            avgPrice: { $avg: '$price' }
        }},
        { $sort: { totalSales: -1 } }
    ]).toArray();
    
    console.log(results);
    // [{ _id: 'Tools', totalSales: 80, avgPrice: 12.5 }]
    
    await client.close();
}

main().catch(console.error);
```

**Supported Stages:**
- `$match` - Filter documents
- `$project` - Reshape documents with expressions
- `$addFields` / `$set` - Add computed fields
- `$unset` - Remove fields
- `$group` - Group and aggregate
- `$sort` - Sort results
- `$limit` / `$skip` - Pagination
- `$lookup` - Join collections
- `$graphLookup` - Recursive joins
- `$facet` - Multiple pipelines
- `$bucket` / `$bucketAuto` - Histogram grouping
- `$sortByCount` - Group and count
- `$geoNear` - Geospatial aggregation
- `$merge` - Write results to collection

**Aggregation Expressions:**
Supports arithmetic (`$add`, `$multiply`), comparison (`$eq`, `$gt`), logical (`$and`, `$or`), string (`$concat`, `$substr`), date (`$year`, `$month`), and array operators (`$size`, `$filter`, `$map`).

### Tests

  `npm test`

### MongoDB Comparison Testing

BabyMongo includes a test harness for comparing behavior against real MongoDB to ensure API compatibility. This helps verify that babymongo behaves identically to MongoDB.

**Quick Start:**

1. Start MongoDB (using Docker):
   ```bash
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

2. Install MongoDB driver:
   ```bash
   npm install mongodb
   ```

3. Run comparison tests:
   ```bash
   npm run test:comparison
   ```

**What's tested:**
- ✅ CRUD operations (insert, find, update, delete)
- ✅ Query operators ($gt, $lt, $in, $and, $or, etc.)
- ✅ Update operators ($set, $inc, $push, $unset, etc.)
- ✅ Aggregation pipelines ($match, $group, $sort, $project, etc.)
- ✅ Complex queries (nested fields, arrays, $elemMatch, etc.)

For detailed documentation, see:
- [MongoDB Comparison Quick Start](docs/MONGODB_COMPARISON_QUICKSTART.md)
- [Complete Documentation](docs/MONGODB_COMPARISON.md)

## In the Browser

BabyMongo works seamlessly in modern browsers with automatic OPFS persistence.

### Installation

You can use BabyMongo from a CDN or build it yourself:

**Option 1: Use pre-built files**

Download the built files:
- Client: https://raw.githubusercontent.com/belteshazzar/babymongo/master/build/babymongo-client.js
- Worker: https://raw.githubusercontent.com/belteshazzar/babymongo/master/build/babymongo-server-worker.js

**Option 2: Build from source**

```bash
npm install
npm run build
```

### Usage in Browser

```html
<!DOCTYPE html>
<html>
<head>
    <title>BabyMongo Browser Example</title>
</head>
<body>
    <h1>BabyMongo in Browser</h1>
    <button id="insert">Insert Data</button>
    <button id="query">Query Data</button>
    <pre id="output"></pre>

    <script type="module">
        import { MongoClient, WorkerBridge } from './build/babymongo-client.js';

        async function main() {
            // Create worker bridge
            const bridge = await WorkerBridge.create();
            
            // Connect to database
            const client = new MongoClient('mongodb://localhost:27017/browserdb', {
                workerBridge: bridge
            });
            await client.connect();
            const db = client.db('browserdb');
            
            const output = document.getElementById('output');
            
            // Insert button handler
            document.getElementById('insert').addEventListener('click', async () => {
                await db.items.insertOne({ 
                    name: 'Item ' + Date.now(), 
                    timestamp: new Date() 
                });
                output.textContent = 'Data inserted and persisted to OPFS!';
            });
            
            // Query button handler
            document.getElementById('query').addEventListener('click', async () => {
                const items = await db.items.find({}).toArray();
                output.textContent = JSON.stringify(items, null, 2);
            });
        }

        main().catch(console.error);
    </script>
</body>
</html>
```

### Browser Features

- **Automatic Persistence:** All data is saved to OPFS and survives page reloads
- **Web Worker:** Database operations run in a worker thread for responsive UI
- **Full MongoDB API:** Query, update, aggregate, indexes, change streams
- **Developer-Friendly:** Check `.opfs` directory in Node.js for debugging

## Architecture

### Web Worker Design

BabyMongo uses a **dual-thread architecture** for optimal performance:

```
┌─────────────────────────────────┐
│      Main Thread (Your App)     │
│  ┌───────────────────────────┐  │
│  │      MongoClient          │  │
│  │      ProxyDB              │  │
│  │      ProxyCollection      │  │
│  └───────────┬───────────────┘  │
│              │ WorkerBridge     │
└──────────────┼──────────────────┘
               │ postMessage()
┌──────────────┼──────────────────┐
│              ▼                   │
│  ┌───────────────────────────┐  │
│  │      Server               │  │
│  │      DB                   │  │
│  │      Collection           │  │
│  │      Indexes              │  │
│  │      OPFS Storage         │  │
│  └───────────────────────────┘  │
│   Worker Thread (Web Worker/    │
│   Worker Thread in Node.js)     │
└─────────────────────────────────┘
```

**How It Works:**

1. **Main Thread:** Your application code runs here. All MongoDB operations are proxied through `WorkerBridge`
2. **Worker Thread:** The actual database engine runs here with direct OPFS access
3. **Communication:** WorkerBridge serializes/deserializes messages between threads
4. **Benefits:** 
   - UI stays responsive during heavy database operations
   - OPFS synchronous APIs available in worker context (fast!)
   - Clean separation of concerns

### Storage with OPFS

The **Origin Private File System** provides fast, persistent storage:

**File Structure:**
```
.opfs/                           # Root (Node.js) or OPFS root (Browser)
└── babymongo/                 # Base folder
    └── {database}/              # Database name
        └── {collection}/        # Collection name
            ├── documents.bj  # B+ tree of documents
            ├── documents.bj.version.json  # Version metadata
            ├── documents.bj.v1            # Old version (during compaction)
            └── {index-name}.bj            # Index B+ trees
```

**Key Features:**

- **Binary JSON (BJSON):** Efficient binary format with ObjectId and Date support
- **B+ Tree Indexes:** Self-balancing trees for fast queries
- **Versioning:** Safe compaction without data loss
- **Reference Counting:** Old versions kept until all readers close
- **Automatic Cleanup:** Old versions deleted when no longer needed

**Example Storage:**

```javascript
// After this code runs:
const db = client.db('store');
await db.products.insertOne({ name: 'Widget', price: 10.99 });
await db.products.createIndex({ name: 1 });

// Storage structure:
// .opfs/babymongo/store/products/documents.bj
// .opfs/babymongo/store/products/name_1.bj
```

### Performance Tuning

BabyMongo uses B+ trees for document storage and indexes. The **branching factor** (tree order) significantly impacts performance based on your document size and workload.

**Configure branching factor per collection:**

```javascript
const db = client.db('myapp');

// For small documents (< 200 bytes) - use default order 50
const events = db.collection('events');

// For large documents (> 2KB) - use lower order (10-20)
const articles = db.collection('articles', { bPlusTreeOrder: 15 });
```

**Recommendations based on document size:**

| Document Size | Recommended Order | Rationale |
|---------------|-------------------|-----------|
| < 200 bytes   | 50 (default)      | Balanced performance across operations |
| 200B - 2KB    | 20-50             | Prevents search degradation |
| > 2KB         | 10-20             | Critical to avoid severe slowdown (13x) |

**Workload considerations:**

- **Write-heavy workloads:** Lower orders (10-20) for faster inserts
- **Read-heavy workloads:** Medium orders (20-50) for balanced search/insert
- **Range-query heavy:** Higher orders (200) for small docs, lower (10-20) for large docs

⚠️ **Warning:** Using high branching factors (200+) with large documents causes catastrophic search performance degradation. See [BPLUSTREE_PERFORMANCE_REPORT.md](BPLUSTREE_PERFORMANCE_REPORT.md) for detailed benchmark results.

### Multiple Clients Sharing a Worker

You can create multiple clients that share the same worker:

```javascript
const bridge = await WorkerBridge.create();

const client1 = new MongoClient('mongodb://localhost/app1', { workerBridge: bridge });
const client2 = new MongoClient('mongodb://localhost/app2', { workerBridge: bridge });

await client1.connect();
await client2.connect();

// Both clients use the same worker thread
// Changes in one client are visible to the other
```

# API Status

The following table summarises the API implementation status.

## Database Methods

| Name                         | Implemented     |
|------------------------------|-----------------|
| db.cloneCollection           | no              |
| db.cloneDatabase             | no              |
| db.commandHelp               | no              |
| db.copyDatabase              | no              |
| db.createCollection          | Yes             |
| db.currentOp                 | N/A             |
| db.dropDatabase              | Yes             |
| db.eval                      | N/A             |
| db.fsyncLock                 | N/A             |
| db.fsyncUnlock               | N/A             |
| db.getCollection             | no              |
| db.getCollectionInfos        | no              |
| db.getCollectionNames        | Yes             |
| db.getLastError              | no              |
| db.getLastErrorObj           | no              |
| db.getLogComponents          | N/A             |
| db.getMongo                  | N/A             |
| db.getName                   | no              |
| db.getPrevError              | no              |
| db.getProfilingLevel         | N/A             |
| db.getProfilingStatus        | N/A             |
| db.getReplicationInfo        | N/A             |
| db.getSiblingDB              | N/A             |
| db.help                      | Yes             |
| db.hostInfo                  | N/A             |
| db.isMaster                  | N/A             |
| db.killOp                    | N/A             |
| db.listCommands              | N/A             |
| db.loadServerScripts         | N/A             |
| db.printCollectionStats      | N/A             |
| db.printReplicationInfo      | N/A             |
| db.printShardingStatus       | N/A             |
| db.printSlaveReplicationInfo | N/A             |
| db.repairDatabase            | N/A             |
| db.resetError                | N/A             |
| db.runCommand                | N/A             |
| db.serverBuildInfo           | N/A             |
| db.serverCmdLineOpts         | N/A             |
| db.serverStatus              | N/A             |
| db.setLogLevel               | N/A             |
| db.setProfilingLevel         | N/A             |
| db.shutdownServer            | N/A             |
| db.stats                     | no              |
| db.version                   | no              |
| db.upgradeCheck              | N/A             |

## Collection Methods

| Name                               | Implemented |
|------------------------------------|-------------|
| db.collection.aggregate            | yes         |
| db.collection.bulkWrite            | no          |
| db.collection.count                | yes         |
| db.collection.copyTo               | yes         |
| db.collection.createIndex          | yes         |
| db.collection.dataSize             | no          |
| db.collection.deleteOne            | yes         |
| db.collection.deleteMany           | yes         |
| db.collection.distinct             | yes         |
| db.collection.drop                 | yes         |
| db.collection.dropIndex            | no          | 
| db.collection.dropIndexes          | no          | 
| db.collection.ensureIndex          | no          | 
| db.collection.explain              | no          | 
| db.collection.find                 | yes         |
| db.collection.findAndModify        | no          | 
| db.collection.findOne              | yes         |
| db.collection.findOneAndDelete     | yes         |
| db.collection.findOneAndReplace    | yes         |
| db.collection.findOneAndUpdate     | yes         |
| db.collection.getIndexes           | yes         |
| db.collection.getShardDistribution | N/A         | 
| db.collection.getShardVersion      | N/A         | 
| db.collection.group                | no          | 
| db.collection.insert               | yes         |
| db.collection.insertOne            | yes         |
| db.collection.insertMany           | yes         |
| db.collection.isCapped             | no          | 
| db.collection.mapReduce            | no          | 
| db.collection.reIndex              | no          | 
| db.collection.replaceOne           | yes         |
| db.collection.remove               | yes         |
| db.collection.renameCollection     | no          | 
| db.collection.save                 | no          | 
| db.collection.stats                | no          | 
| db.collection.storageSize          | no          | 
| db.collection.totalSize            | no          | 
| db.collection.totalIndexSize       | no          | 
| db.collection.update               | yes         |
| db.collection.updateOne            | yes         |
| db.collection.updateMany           | yes         |
| db.collection.validate             | no          |
| db.collection.watch                | yes         |

## Change Streams

**NEW:** BabyMongo supports change streams for reactive programming! Watch for real-time data changes at the collection, database, or client level.

```javascript
import { MongoClient, WorkerBridge } from 'babymongo';

async function main() {
    const bridge = await WorkerBridge.create();
    const client = new MongoClient('mongodb://localhost:27017/myapp', {
        workerBridge: bridge
    });
    await client.connect();
    const db = client.db('myapp');
    const collection = db.collection('users');

    // Watch for changes to a collection (synchronous, returns immediately)
    const changeStream = collection.watch();
    
    changeStream.on('change', (change) => {
        console.log('Change detected:', change.operationType);
        console.log('Document:', change.fullDocument);
    });
    
    // Make changes - they'll trigger the change stream
    await collection.insertOne({ name: 'Alice', age: 30 });
    await collection.updateOne({ name: 'Alice' }, { $set: { age: 31 } });
    await collection.deleteOne({ name: 'Alice' });
    
    // Filter changes using aggregation pipelines (also synchronous)
    const filtered = collection.watch([
        { $match: { 'fullDocument.age': { $gte: 30 } } }
    ]);
    
    // Watch at database level (async, requires await)
    const dbStream = await db.watch();
    
    // Close when done
    changeStream.close();
    
    await client.close();
}

main().catch(console.error);
```

See [CHANGE-STREAMS.md](CHANGE-STREAMS.md) for complete documentation, examples, and browser reactivity patterns.

## Filtered Positional Operator with arrayFilters

**NEW:** BabyMongo supports the filtered positional operator `$[<identifier>]` with `arrayFilters`, allowing you to update specific array elements that match filter conditions!

```javascript
import { MongoClient, WorkerBridge } from 'babymongo';

async function main() {
    const bridge = await WorkerBridge.create();
    const client = new MongoClient('mongodb://localhost:27017/myapp', {
        workerBridge: bridge
    });
    await client.connect();
    const db = client.db('myapp');

    // Update items with quantity <= 5
    await db.products.insertOne({
        _id: 1,
        items: [
            { name: 'apple', quantity: 5 },
            { name: 'banana', quantity: 0 },
            { name: 'orange', quantity: 10 }
        ]
    });
    
    await db.products.updateOne(
        { _id: 1 },
        { $set: { 'items.$[elem].quantity': 100 } },
        { arrayFilters: [{ 'elem.quantity': { $lte: 5 } }] }
    );
    // Result: apple and banana quantity set to 100, orange remains 10
    
    // Update simple arrays
    await db.scores.updateOne(
        { _id: 1 },
        { $set: { 'scores.$[score]': 90 } },
        { arrayFilters: [{ 'score': { $lt: 90 } }] }
    );
    
    // Nested arrays with multiple filters
    await db.students.updateOne(
        { _id: 1 },
        { $inc: { 'students.$[student].grades.$[grade].score': 5 } },
        { 
            arrayFilters: [
                { 'student.name': 'Alice' },
                { 'grade.score': { $lt: 90 } }
            ] 
        }
    );
    
    await client.close();
}

main().catch(console.error);
```

See [docs/ARRAY-FILTERS.md](docs/ARRAY-FILTERS.md) for complete documentation and examples.

## Cursor Methods

| Name                    | Implemented     |
|-------------------------|-----------------|
| cursor.batchSize        | N/A             |
| cursor.close            | N/A             |
| cursor.comment          | no              |
| cursor.count            | yes             |
| cursor.explain          | N/A             |
| cursor.forEach          | yes             |
| cursor.hasNext          | yes             |
| cursor.hint             | N/A             |
| cursor.itcount          | no              |
| cursor.limit            | yes             |
| cursor.map              | yes             |
| cursor.maxScan          | N/A             |
| cursor.maxTimeMS        | N/A             |
| cursor.max              | no              |
| cursor.min              | no              |
| cursor.next             | yes             |
| cursor.noCursorTimeout  | N/A             |
| cursor.objsLeftInBatch  | N/A             |
| cursor.pretty           | no              |
| cursor.readConcern      | N/A             |
| cursor.readPref         | N/A             |
| cursor.returnKey        | N/A             |
| cursor.showRecordId     | N/A             |
| cursor.size             | no              |
| cursor.skip             | yes             |
| cursor.snapshot         | no              |
| cursor.sort             | yes             |
| cursor.tailable         | no              |
| cursor.toArray          | yes             |
| cursor.next()           | yes             |


