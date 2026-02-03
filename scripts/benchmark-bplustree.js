import * as path from 'path';
import { fileURLToPath } from 'url';
import { StorageManager } from 'node-opfs';
import { BPlusTree } from '@belteshazzar/binjson/bplustree';
import { getFileHandle } from '@belteshazzar/binjson';
import * as fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const opfsDir = path.join(projectRoot, '.opfs-benchmark');

// Configure node-opfs
const customStorage = new StorageManager(opfsDir);
if (typeof globalThis.navigator === 'undefined') {
	globalThis.navigator = {};
}
globalThis.navigator.storage = {
	getDirectory: () => customStorage.getDirectory()
};

/**
 * Generate a document of specified size in bytes
 */
function generateDocument(size, id) {
	const baseDoc = {
		_id: id,
		name: `doc_${id}`,
		timestamp: Date.now(),
		counter: id
	};
	
	// Calculate how much padding is needed
	const baseSize = JSON.stringify(baseDoc).length;
	const paddingSize = Math.max(0, size - baseSize - 20); // Leave room for padding field
	
	if (paddingSize > 0) {
		baseDoc.padding = 'x'.repeat(paddingSize);
	}
	
	return baseDoc;
}

/**
 * Run benchmark for a specific configuration
 */
async function runBenchmark(config) {
	const { branchingFactor, documentSize, numDocuments, testName } = config;
	
	console.log(`\n${'='.repeat(80)}`);
	console.log(`Running: ${testName}`);
	console.log(`  Branching Factor: ${branchingFactor}`);
	console.log(`  Document Size: ${documentSize} bytes`);
	console.log(`  Number of Documents: ${numDocuments}`);
	console.log(`${'='.repeat(80)}\n`);
	
	const results = {
		config,
		insertTime: 0,
		searchTime: 0,
		rangeSearchTime: 0,
		deleteTime: 0,
		treeHeight: null,
		fileSize: 0,
		error: null
	};
	
	try {
		// Clean up any existing test file
		const testFileName = `benchmark-${branchingFactor}-${documentSize}-${numDocuments}.bj`;
		const testFilePath = path.join(opfsDir, testFileName);
		try {
			await fs.unlink(testFilePath);
		} catch (e) {
			// Ignore if file doesn't exist
		}
		
		// Get directory handle and create file
		const dirHandle = await navigator.storage.getDirectory();
		const fileHandle = await getFileHandle(dirHandle, testFileName, { create: true });
		const syncHandle = await fileHandle.createSyncAccessHandle();
		
		// Create B+ tree with specified branching factor
		const tree = new BPlusTree(syncHandle, branchingFactor);
		await tree.open();
		
		// ===== INSERT BENCHMARK =====
		console.log('  Running INSERT benchmark...');
		const insertStart = performance.now();
		
		for (let i = 0; i < numDocuments; i++) {
			const doc = generateDocument(documentSize, i);
			const key = `key_${String(i).padStart(10, '0')}`; // Padded for sorted order
			await tree.add(key, JSON.stringify(doc));
		}
		
		const insertEnd = performance.now();
		results.insertTime = insertEnd - insertStart;
		console.log(`    ✓ INSERT completed in ${results.insertTime.toFixed(2)}ms (${(numDocuments / (results.insertTime / 1000)).toFixed(2)} ops/sec)`);
		
		// ===== SEARCH BENCHMARK (point queries) =====
		console.log('  Running SEARCH benchmark...');
		const searchStart = performance.now();
		
		// Perform random searches
		const numSearches = Math.min(1000, numDocuments);
		for (let i = 0; i < numSearches; i++) {
			const randomId = Math.floor(Math.random() * numDocuments);
			const key = `key_${String(randomId).padStart(10, '0')}`;
			const result = await tree.search(key);
			if (!result) {
				console.warn(`    Warning: Search for ${key} returned no results`);
			}
		}
		
		const searchEnd = performance.now();
		results.searchTime = searchEnd - searchStart;
		console.log(`    ✓ SEARCH completed in ${results.searchTime.toFixed(2)}ms (${(numSearches / (results.searchTime / 1000)).toFixed(2)} ops/sec)`);
		
		// ===== RANGE SEARCH BENCHMARK =====
		console.log('  Running RANGE SEARCH benchmark...');
		const rangeSearchStart = performance.now();
		
		// Perform range searches
		const numRangeSearches = 100;
		const rangeSize = Math.floor(numDocuments / 10); // Each range covers 10% of data
		
		for (let i = 0; i < numRangeSearches; i++) {
			const startId = Math.floor(Math.random() * (numDocuments - rangeSize));
			const endId = startId + rangeSize;
			const startKey = `key_${String(startId).padStart(10, '0')}`;
			const endKey = `key_${String(endId).padStart(10, '0')}`;
			
			const results = await tree.rangeSearch(startKey, endKey);
			// Count results to ensure they're processed
			let count = 0;
			for await (const _ of results) {
				count++;
			}
		}
		
		const rangeSearchEnd = performance.now();
		results.rangeSearchTime = rangeSearchEnd - rangeSearchStart;
		console.log(`    ✓ RANGE SEARCH completed in ${results.rangeSearchTime.toFixed(2)}ms (${(numRangeSearches / (results.rangeSearchTime / 1000)).toFixed(2)} ops/sec)`);
		
		// ===== DELETE BENCHMARK =====
		console.log('  Running DELETE benchmark...');
		const deleteStart = performance.now();
		
		// Delete random documents
		const numDeletes = Math.min(100, numDocuments);
		for (let i = 0; i < numDeletes; i++) {
			const randomId = Math.floor(Math.random() * numDocuments);
			const key = `key_${String(randomId).padStart(10, '0')}`;
			await tree.delete(key);
		}
		
		const deleteEnd = performance.now();
		results.deleteTime = deleteEnd - deleteStart;
		console.log(`    ✓ DELETE completed in ${results.deleteTime.toFixed(2)}ms (${(numDeletes / (results.deleteTime / 1000)).toFixed(2)} ops/sec)`);
		
		// Get tree statistics
		try {
			// Try to get tree height if method exists
			if (tree.height) {
				results.treeHeight = tree.height();
			} else if (tree.getHeight) {
				results.treeHeight = tree.getHeight();
			}
		} catch (e) {
			// Tree height method might not be available
			results.treeHeight = 'N/A';
		}
		
		// Close the tree
		await tree.close();
		
		// Get file size
		try {
			const stats = await fs.stat(testFilePath);
			results.fileSize = stats.size;
			console.log(`    File size: ${(results.fileSize / 1024).toFixed(2)} KB`);
		} catch (e) {
			console.warn(`    Warning: Could not get file size: ${e.message}`);
		}
		
		console.log(`\n  Results Summary:`);
		console.log(`    Insert Time:       ${results.insertTime.toFixed(2)}ms`);
		console.log(`    Search Time:       ${results.searchTime.toFixed(2)}ms`);
		console.log(`    Range Search Time: ${results.rangeSearchTime.toFixed(2)}ms`);
		console.log(`    Delete Time:       ${results.deleteTime.toFixed(2)}ms`);
		console.log(`    Tree Height:       ${results.treeHeight}`);
		
	} catch (error) {
		console.error(`  ✗ ERROR: ${error.message}`);
		console.error(`    Stack: ${error.stack}`);
		results.error = {
			message: error.message,
			stack: error.stack
		};
	}
	
	return results;
}

/**
 * Main benchmark runner
 */
async function main() {
	console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
	console.log('║          B+ Tree Branching Factor Performance Investigation                   ║');
	console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');
	
	// Clean test directory
	console.log('Cleaning up test directory...');
	try {
		await fs.rm(opfsDir, { recursive: true, force: true });
	} catch (e) {
		// Ignore
	}
	await fs.mkdir(opfsDir, { recursive: true });
	
	// Define test configurations
	const branchingFactors = [10, 20, 50, 100, 200, 500];
	const documentSizes = [
		{ label: 'Small', size: 100 },
		{ label: 'Medium', size: 1000 },
		{ label: 'Large', size: 10000 }
	];
	const numDocuments = 1000; // Number of documents to insert
	
	const allResults = [];
	
	// Run benchmarks for all combinations
	for (const docSizeConfig of documentSizes) {
		for (const branchingFactor of branchingFactors) {
			const config = {
				branchingFactor,
				documentSize: docSizeConfig.size,
				documentSizeLabel: docSizeConfig.label,
				numDocuments,
				testName: `${docSizeConfig.label} Docs (${docSizeConfig.size}B) @ Order ${branchingFactor}`
			};
			
			const result = await runBenchmark(config);
			allResults.push(result);
			
			// Small delay between tests
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}
	
	// Generate summary report
	console.log('\n\n╔═══════════════════════════════════════════════════════════════════════════════╗');
	console.log('║                           PERFORMANCE SUMMARY                                 ║');
	console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');
	
	// Group results by document size
	const resultsByDocSize = {};
	for (const result of allResults) {
		const label = result.config.documentSizeLabel;
		if (!resultsByDocSize[label]) {
			resultsByDocSize[label] = [];
		}
		resultsByDocSize[label].push(result);
	}
	
	// Print summary for each document size
	for (const [label, results] of Object.entries(resultsByDocSize)) {
		console.log(`\n${label} Documents (${results[0].config.documentSize} bytes):`);
		console.log(`${'─'.repeat(80)}`);
		console.log(`${'Order'.padEnd(8)} ${'Insert(ms)'.padEnd(12)} ${'Search(ms)'.padEnd(12)} ${'Range(ms)'.padEnd(12)} ${'Delete(ms)'.padEnd(12)} ${'File(KB)'.padEnd(10)} ${'Errors'}`);
		console.log(`${'─'.repeat(80)}`);
		
		for (const result of results) {
			const order = String(result.config.branchingFactor).padEnd(8);
			const insert = result.error ? 'ERROR'.padEnd(12) : result.insertTime.toFixed(2).padEnd(12);
			const search = result.error ? 'ERROR'.padEnd(12) : result.searchTime.toFixed(2).padEnd(12);
			const range = result.error ? 'ERROR'.padEnd(12) : result.rangeSearchTime.toFixed(2).padEnd(12);
			const del = result.error ? 'ERROR'.padEnd(12) : result.deleteTime.toFixed(2).padEnd(12);
			const fileSize = result.error ? 'N/A'.padEnd(10) : (result.fileSize / 1024).toFixed(2).padEnd(10);
			const errors = result.error ? '✗' : '✓';
			
			console.log(`${order} ${insert} ${search} ${range} ${del} ${fileSize} ${errors}`);
		}
	}
	
	// Identify best performers
	console.log('\n\nBest Performers:');
	console.log(`${'═'.repeat(80)}`);
	
	for (const [label, results] of Object.entries(resultsByDocSize)) {
		const validResults = results.filter(r => !r.error);
		
		if (validResults.length === 0) {
			console.log(`\n${label} Documents: All tests failed`);
			continue;
		}
		
		const bestInsert = validResults.reduce((best, r) => r.insertTime < best.insertTime ? r : best);
		const bestSearch = validResults.reduce((best, r) => r.searchTime < best.searchTime ? r : best);
		const bestRange = validResults.reduce((best, r) => r.rangeSearchTime < best.rangeSearchTime ? r : best);
		const bestDelete = validResults.reduce((best, r) => r.deleteTime < best.deleteTime ? r : best);
		
		console.log(`\n${label} Documents:`);
		console.log(`  Best Insert:       Order ${bestInsert.config.branchingFactor} (${bestInsert.insertTime.toFixed(2)}ms)`);
		console.log(`  Best Search:       Order ${bestSearch.config.branchingFactor} (${bestSearch.searchTime.toFixed(2)}ms)`);
		console.log(`  Best Range Search: Order ${bestRange.config.branchingFactor} (${bestRange.rangeSearchTime.toFixed(2)}ms)`);
		console.log(`  Best Delete:       Order ${bestDelete.config.branchingFactor} (${bestDelete.deleteTime.toFixed(2)}ms)`);
	}
	
	// Report any errors
	const errorsFound = allResults.filter(r => r.error);
	if (errorsFound.length > 0) {
		console.log('\n\nErrors Encountered:');
		console.log(`${'═'.repeat(80)}`);
		for (const result of errorsFound) {
			console.log(`\n${result.config.testName}:`);
			console.log(`  Error: ${result.error.message}`);
			console.log(`  Stack: ${result.error.stack.split('\n').slice(0, 3).join('\n')}`);
		}
	}
	
	// Save detailed results to JSON file
	const reportPath = path.join(projectRoot, 'bplustree-benchmark-results.json');
	await fs.writeFile(reportPath, JSON.stringify(allResults, null, 2));
	console.log(`\n\nDetailed results saved to: ${reportPath}`);
	
	// Clean up test directory
	console.log('\nCleaning up test files...');
	try {
		await fs.rm(opfsDir, { recursive: true, force: true });
	} catch (e) {
		console.warn(`Warning: Could not clean up test directory: ${e.message}`);
	}
	
	console.log('\n✓ Benchmark completed successfully!\n');
}

// Run the benchmark
main().catch(error => {
	console.error('Fatal error running benchmark:', error);
	process.exit(1);
});
