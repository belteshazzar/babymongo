#!/usr/bin/env node

/**
 * Simple script to generate ASCII charts from benchmark results
 * Run: node scripts/visualize-benchmark.js
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
	// Read benchmark results
	const resultsPath = path.join(projectRoot, 'bplustree-benchmark-results.json');
	const resultsData = await fs.readFile(resultsPath, 'utf8');
	const results = JSON.parse(resultsData);
	
	console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
	console.log('║              B+ Tree Branching Factor Performance Visualization               ║');
	console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');
	
	// Group by document size
	const byDocSize = {};
	for (const result of results) {
		const label = result.config.documentSizeLabel;
		if (!byDocSize[label]) {
			byDocSize[label] = [];
		}
		byDocSize[label].push(result);
	}
	
	// Create ASCII bar charts for each metric
	const metrics = [
		{ key: 'insertTime', label: 'INSERT Performance', unit: 'ms', lowerIsBetter: true },
		{ key: 'searchTime', label: 'SEARCH Performance', unit: 'ms', lowerIsBetter: true },
		{ key: 'rangeSearchTime', label: 'RANGE SEARCH Performance', unit: 'ms', lowerIsBetter: true },
		{ key: 'fileSize', label: 'File Size', unit: 'KB', lowerIsBetter: true }
	];
	
	for (const [docSizeLabel, docResults] of Object.entries(byDocSize)) {
		console.log(`\n${'='.repeat(80)}`);
		console.log(`${docSizeLabel} Documents (${docResults[0].config.documentSize} bytes)`);
		console.log(`${'='.repeat(80)}\n`);
		
		for (const metric of metrics) {
			console.log(`\n${metric.label} (${metric.unit}) - ${metric.lowerIsBetter ? 'Lower is Better' : 'Higher is Better'}:`);
			console.log('─'.repeat(80));
			
			// Find min and max for scaling
			const values = docResults.map(r => r[metric.key] / (metric.unit === 'KB' ? 1024 : 1));
			const min = Math.min(...values);
			const max = Math.max(...values);
			const range = max - min;
			
			// Find best performer
			const bestValue = metric.lowerIsBetter ? min : max;
			
			for (const result of docResults) {
				const order = result.config.branchingFactor;
				const value = result[metric.key] / (metric.unit === 'KB' ? 1024 : 1);
				
				// Scale to 50 chars max
				const barLength = range === 0 ? 50 : Math.round(((value - min) / range) * 50);
				const bar = '█'.repeat(barLength);
				
				// Mark best performer
				const isBest = value === bestValue;
				const marker = isBest ? ' ⭐ BEST' : '';
				
				// Format value
				let displayValue;
				if (metric.unit === 'KB') {
					displayValue = value > 1024 ? `${(value / 1024).toFixed(1)} MB` : `${value.toFixed(0)} KB`;
				} else {
					displayValue = value > 1000 ? `${(value / 1000).toFixed(1)}s` : `${value.toFixed(0)}ms`;
				}
				
				console.log(`Order ${String(order).padStart(3)}: ${bar} ${displayValue}${marker}`);
			}
		}
	}
	
	// Performance impact summary
	console.log('\n\n' + '='.repeat(80));
	console.log('PERFORMANCE IMPACT SUMMARY');
	console.log('='.repeat(80));
	
	for (const [docSizeLabel, docResults] of Object.entries(byDocSize)) {
		console.log(`\n${docSizeLabel} Documents:`);
		
		// Calculate performance changes from order 10 to 500
		const order10 = docResults.find(r => r.config.branchingFactor === 10);
		const order500 = docResults.find(r => r.config.branchingFactor === 500);
		
		const insertChange = ((order500.insertTime - order10.insertTime) / order10.insertTime * 100).toFixed(0);
		const searchChange = ((order500.searchTime - order10.searchTime) / order10.searchTime * 100).toFixed(0);
		const rangeChange = ((order500.rangeSearchTime - order10.rangeSearchTime) / order10.rangeSearchTime * 100).toFixed(0);
		const sizeChange = ((order500.fileSize - order10.fileSize) / order10.fileSize * 100).toFixed(0);
		
		console.log(`  Order 10 → 500 Impact:`);
		console.log(`    INSERT:       ${insertChange > 0 ? '+' : ''}${insertChange}% ${insertChange > 0 ? '⚠️ SLOWER' : '✓ FASTER'}`);
		console.log(`    SEARCH:       ${searchChange > 0 ? '+' : ''}${searchChange}% ${searchChange > 0 ? '⚠️ SLOWER' : '✓ FASTER'}`);
		console.log(`    RANGE SEARCH: ${rangeChange > 0 ? '+' : ''}${rangeChange}% ${rangeChange > 0 ? '⚠️ SLOWER' : '✓ FASTER'}`);
		console.log(`    FILE SIZE:    ${sizeChange > 0 ? '+' : ''}${sizeChange}% ${sizeChange > 0 ? '⚠️ LARGER' : '✓ SMALLER'}`);
	}
	
	// Recommendations
	console.log('\n\n' + '='.repeat(80));
	console.log('RECOMMENDATIONS');
	console.log('='.repeat(80));
	console.log(`
📋 Based on the benchmark results:

1. Small Documents (< 200 bytes):
   • Use order 50 (current default) ✓
   • Good balance across all operations
   • Acceptable storage overhead

2. Medium Documents (200B - 2KB):
   • Use order 20-50
   • Prevents severe search degradation
   • Maintains good insert performance

3. Large Documents (> 2KB):
   • Use order 10-20 ⚠️ CRITICAL
   • Higher orders cause catastrophic search slowdown (13x slower!)
   • Essential for maintaining acceptable performance

4. Workload-Specific:
   • Write-heavy: Lower orders (10-20)
   • Balanced: Medium orders (20-50)
   • Range-query heavy (small docs): Higher orders (200)
   • Range-query heavy (large docs): Lower orders (10-20)

⚠️  WARNING: Document size has dramatic impact on optimal branching factor!
	`);
}

main().catch(error => {
	console.error('Error:', error);
	process.exit(1);
});
