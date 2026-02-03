# BabyMongo Scripts

This directory contains utility and experimental scripts for the BabyMongo project.

## Performance Investigation Scripts

### B+ Tree Branching Factor Benchmarks

#### `benchmark-bplustree.js`

Comprehensive performance investigation of B+ tree branching factors across different document sizes.

**Usage:**
```bash
node scripts/benchmark-bplustree.js
```

**What it does:**
- Tests 6 branching factors: 10, 20, 50, 100, 200, 500
- Tests 3 document sizes: 100 bytes (small), 1000 bytes (medium), 10000 bytes (large)
- Performs 4 types of operations: INSERT, SEARCH, RANGE SEARCH, DELETE
- Measures execution time and file sizes for each configuration
- Generates JSON results file: `bplustree-benchmark-results.json`

**Duration:** Approximately 25 minutes for full test suite

**Output:**
- Console output with detailed progress and summary tables
- `bplustree-benchmark-results.json` - Raw benchmark data

#### `visualize-benchmark.js`

Visualizes the benchmark results with ASCII charts and analysis.

**Usage:**
```bash
node scripts/visualize-benchmark.js
```

**Requirements:**
- Must have run `benchmark-bplustree.js` first to generate results file

**What it displays:**
- ASCII bar charts for each metric (INSERT, SEARCH, RANGE SEARCH, FILE SIZE)
- Performance impact summary showing changes from order 10 to 500
- Recommendations based on document size and workload

**Example output:**
```
INSERT Performance (ms) - Lower is Better:
────────────────────────────────────────────────
Order  10: ██ 266ms
Order  20:  229ms ⭐ BEST
Order  50: ██ 277ms
Order 100: ████████ 392ms
...
```

## Other Scripts

### `bundling-verify.sh`

Verifies the build output and bundling configuration.

## Running Scripts

All scripts should be run from the project root:

```bash
# From project root
node scripts/benchmark-bplustree.js
node scripts/visualize-benchmark.js
```

## Results and Reports

After running the benchmarks, you'll have:

1. **`bplustree-benchmark-results.json`** (project root)
   - Raw JSON data from all test runs
   - Contains detailed metrics for each configuration

2. **`BPLUSTREE_PERFORMANCE_REPORT.md`** (project root)
   - Comprehensive analysis and findings
   - Recommendations for different use cases
   - Detailed tables and insights

## Dependencies

The benchmark scripts require:
- Node.js 20.x or later
- Project dependencies installed (`npm install`)
- `node-opfs` for OPFS storage emulation
- `@belteshazzar/binjson` for B+ tree implementation

## Notes

- Benchmark temporary files are created in `.opfs-benchmark/` (gitignored)
- Test runs are sequential to avoid interference
- Each test uses a fresh B+ tree file
- Memory usage scales with branching factor - high orders may use significant RAM
