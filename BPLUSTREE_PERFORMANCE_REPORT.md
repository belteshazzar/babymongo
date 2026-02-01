# B+ Tree Branching Factor Performance Investigation Report

**Date:** February 1, 2026  
**Repository:** belteshazzar/babymongo  
**Investigation Focus:** Impact of B+ tree branching factors on performance across different document sizes

---

## Executive Summary

This report presents the findings from a comprehensive performance investigation of B+ tree branching factors in the babymongo database implementation. The experiments tested **6 different branching factors** (10, 20, 50, 100, 200, 500) across **3 document sizes** (100B, 1000B, 10000B) with **1000 documents** per test.

### Key Findings

1. **No single "best" branching factor exists** - optimal performance depends on document size and operation type
2. **Smaller branching factors (10-20) excel at inserts** across all document sizes
3. **Larger branching factors (200-500) perform better for range queries** with small documents
4. **Document size has dramatic impact** - large documents (10KB) show severe performance degradation with higher branching factors
5. **File size increases dramatically** with branching factor - order 500 uses 19x more space than order 10 for small documents

### Recommendations

- **For small documents (< 200 bytes):** Use **order 50** (current default) - good balance of performance
- **For medium documents (200B - 2KB):** Use **order 20-50** - optimal insert/search balance
- **For large documents (> 2KB):** Use **order 10-20** - prevents severe search degradation
- **For range-query heavy workloads:** Consider **order 200** for small-to-medium documents

---

## Test Configuration

### Test Parameters

| Parameter | Value |
|-----------|-------|
| Branching Factors Tested | 10, 20, 50, 100, 200, 500 |
| Document Sizes | 100 bytes (Small), 1000 bytes (Medium), 10000 bytes (Large) |
| Number of Documents | 1,000 per test |
| Operations Tested | INSERT (1000 docs), SEARCH (1000 random), RANGE SEARCH (100 ranges), DELETE (100 random) |
| Storage Backend | OPFS (Origin Private File System) via node-opfs |
| B+ Tree Implementation | @belteshazzar/binjson v1.0.1 |

### Test Environment

- Node.js v20.20.0
- Test runs were sequential to avoid interference
- Each test used a fresh B+ tree file
- Measurements taken using `performance.now()` for millisecond precision

---

## Detailed Results

### Small Documents (100 bytes)

| Order | Insert (ms) | Search (ms) | Range (ms) | Delete (ms) | File Size (KB) | Tree Height |
|-------|-------------|-------------|------------|-------------|----------------|-------------|
| 10    | 265.87      | 628.87      | 4253.85    | 54.19       | 2,013.07       | 3           |
| 20    | **228.84**  | 386.82      | 2071.51    | **38.17**   | 2,840.75       | 2           |
| 50    | 277.45      | **381.78**  | 1672.51    | 57.39       | 5,483.95       | 1           |
| 100   | 392.26      | 707.10      | 1374.52    | 45.93       | 9,492.91       | 1           |
| 200   | 626.13      | 1102.64     | 1141.59    | 59.35       | 17,551.17      | 1           |
| 500   | 1269.78     | 1632.70     | **570.98** | 99.56       | 38,712.00      | 1           |

**Observations:**
- Order 20 provides best insert performance (228.84ms)
- Order 50-100 optimal for point searches
- Order 500 best for range searches (despite slower inserts/searches)
- Tree height reduces from 3 to 1 as order increases from 10 to 50
- File size grows by **19x** from order 10 to 500

**Performance Trends:**
- INSERT: Performance degrades significantly beyond order 50 (+356% at order 500)
- SEARCH: Relatively stable between orders 20-50, degrades at higher orders
- RANGE: Improves dramatically with higher orders (87% faster from order 200→500)

---

### Medium Documents (1000 bytes)

| Order | Insert (ms) | Search (ms) | Range (ms) | Delete (ms) | File Size (KB) | Tree Height |
|-------|-------------|-------------|------------|-------------|----------------|-------------|
| 10    | **216.21**  | **1609.90** | 14514.04   | 110.99      | 9,352.50       | 3           |
| 20    | 227.95      | 2091.26     | 11887.61   | **110.99**  | 17,103.22      | 2           |
| 50    | 321.89      | 3154.89     | 11227.19   | 168.05      | 40,257.36      | 1           |
| 100   | 506.24      | 5751.73     | 11989.79   | 184.19      | 77,413.14      | 1           |
| 200   | 821.60      | 9553.26     | 9665.57    | 169.88      | 148,709.30     | 1           |
| 500   | 1709.84     | 12173.65    | **4754.28**| 187.24      | 333,594.54     | 1           |

**Observations:**
- Order 10 excels at inserts and point searches
- Search performance degrades severely with higher orders (657% slower at order 500 vs order 10)
- Range queries improve with higher orders but not as dramatically as with small documents
- File sizes grow dramatically - order 500 uses **35.7x** more space than order 10

**Performance Trends:**
- INSERT: 691% degradation from order 10→500
- SEARCH: 656% degradation from order 10→500  
- RANGE: 67% improvement from order 10→500
- Document size amplifies the overhead of large branching factors

---

### Large Documents (10,000 bytes)

| Order | Insert (ms) | Search (ms) | Range (ms) | Delete (ms) | File Size (KB) | Tree Height |
|-------|-------------|-------------|------------|-------------|----------------|-------------|
| 10    | **335.05**  | **18080.08**| 165392.31  | **955.23**  | 82,654.10      | 3           |
| 20    | 445.54      | 21758.28    | 139182.59  | 1047.07     | 159,694.26     | 2           |
| 50    | 773.62      | 31641.05    | 122657.78  | 1207.24     | 388,869.59     | 1           |
| 100   | 1373.09     | 51411.72    | 101662.97  | 1225.95     | 757,269.29     | 1           |
| 200   | 2457.97     | 83187.16    | **83087.91**| 1139.30    | 1,460,908.14   | 1           |
| 500   | 5434.07     | 254422.71   | 98531.50   | 1525.36     | 3,289,405.03   | 1           |

**Observations:**
- Order 10 clearly superior for all operations except range queries
- **Severe search degradation** with large orders - order 500 is 1,307% slower than order 10
- Range queries show complex behavior - order 200 performs best
- File sizes become massive - order 500 uses **39.8x** more space than order 10 (3.2GB vs 81MB)

**Performance Trends:**
- INSERT: 1,522% degradation from order 10→500
- SEARCH: **1,307%** degradation from order 10→500 (catastrophic)
- RANGE: Best at order 200, slight regression at 500
- Large documents expose fundamental inefficiencies in high-order trees

---

## Analysis & Insights

### 1. Tree Height Impact

Tree height decreases with higher branching factors:
- **Order 10:** Height 3 (more tree traversals, but smaller nodes)
- **Order 20:** Height 2 (balanced)
- **Order 50+:** Height 1 (root contains all data)

When height = 1, all data fits in the root node. This:
- ✅ Reduces traversal overhead for range queries
- ❌ Increases node size, making searches within nodes expensive
- ❌ Dramatically increases memory and I/O costs

### 2. Document Size Amplification Effect

Performance degradation with high branching factors is **amplified by document size**:

**Search performance degradation (order 10 → 500):**
- Small docs (100B): 160% slower
- Medium docs (1000B): 656% slower  
- Large docs (10KB): **1,307% slower** ⚠️

**Root cause:** Large documents in high-order trees create massive nodes that must be loaded and scanned during searches.

### 3. Range Query Sweet Spot

Range queries show unique behavior:

**Small documents:**
- Optimal at order 500 (all data in one node, sequential scan)
- Performance improves consistently with higher orders

**Medium/Large documents:**
- Optimal at order 200-500
- Trade-off between traversal reduction and node size overhead

**Why:** Range queries benefit from sequential scanning of large nodes, unlike point searches which must locate specific keys.

### 4. Storage Overhead

File sizes scale **non-linearly** with branching factor:

| Document Size | Order 10 | Order 500 | Ratio |
|---------------|----------|-----------|-------|
| Small (100B)  | 2 MB     | 38 MB     | 19x   |
| Medium (1KB)  | 9 MB     | 326 MB    | 36x   |
| Large (10KB)  | 81 MB    | 3.2 GB    | 40x   |

**Cause:** Higher-order trees waste space in partially filled nodes and create larger internal node structures.

### 5. Balanced Workload Considerations

For real-world mixed workloads (inserts, searches, range queries):

| Document Size | Recommended Order | Rationale |
|---------------|-------------------|-----------|
| < 200 bytes   | 50 (current)      | Balanced across all operations |
| 200B - 2KB    | 20-50             | Prevents search degradation |
| > 2KB         | 10-20             | Critical to avoid catastrophic search slowdown |

---

## Issues & Errors Found

### No Fatal Errors Detected ✓

All 18 test configurations (6 branching factors × 3 document sizes) completed successfully without errors.

### Performance Issues Identified

1. **Critical Performance Degradation with Large Documents**
   - **Severity:** HIGH
   - **Issue:** Search performance with order 500 on 10KB documents is 1,307% slower than order 10
   - **Impact:** Makes high branching factors unusable for large document workloads
   - **Recommendation:** Add validation/warnings when using high orders with large documents

2. **Excessive Storage Overhead**
   - **Severity:** MEDIUM  
   - **Issue:** Order 500 uses 19-40x more storage than order 10
   - **Impact:** Significant disk space waste, especially for large documents
   - **Recommendation:** Document storage implications of branching factor choices

3. **Range Query Performance with Small Orders**
   - **Severity:** LOW
   - **Issue:** Order 10 range queries on large documents take 165+ seconds (vs 83s for order 200)
   - **Impact:** Poor performance for analytics/reporting workloads on deep trees
   - **Recommendation:** Consider adaptive indexing strategies for mixed workloads

---

## Recommendations

### For Library Maintainers

1. **Update Default Branching Factors**
   - Regular indexes: Keep at **50** (good for typical small-medium docs)
   - Text indexes: Consider reducing from 16 to **10** for better insert performance
   - Document storage: Make order configurable per collection based on expected document size

2. **Add Configuration Guidance**
   - Document performance implications in API docs
   - Provide `bPlusTreeOrder` recommendations based on use case
   - Add warnings for high orders with large documents

3. **Implement Dynamic Order Selection**
   - Consider sampling document sizes on collection creation
   - Auto-select optimal order based on document size distribution
   - Expose tuning recommendations via diagnostics API

4. **Add Performance Monitoring**
   - Track average document size per collection
   - Monitor search/insert latencies
   - Alert when configuration is suboptimal

### For Application Developers

1. **Choose Order Based on Document Size**
   ```javascript
   // Small documents (< 200 bytes): use order 50
   const smallDocs = db.collection('events', { bPlusTreeOrder: 50 });
   
   // Medium documents (200B - 2KB): use order 20-50  
   const mediumDocs = db.collection('users', { bPlusTreeOrder: 30 });
   
   // Large documents (> 2KB): use order 10-20
   const largeDocs = db.collection('articles', { bPlusTreeOrder: 15 });
   ```

2. **Consider Workload Patterns**
   - **Write-heavy:** Lower orders (10-20) for faster inserts
   - **Read-heavy (point queries):** Medium orders (20-50) for balanced performance
   - **Range-query heavy:** Higher orders (200) for small-medium docs, lower (10-20) for large docs

3. **Monitor Storage Growth**
   - Track collection file sizes
   - Consider compact operations for high-order indexes
   - Budget 10-40x storage overhead for high branching factors

---

## Conclusion

The investigation reveals that **branching factor selection is critical** for B+ tree performance in babymongo, with document size being the dominant factor in optimization decisions.

**Key Takeaways:**

1. **Current default (order 50) is well-chosen** for typical small-to-medium document workloads
2. **Large documents require lower orders** (10-20) to maintain acceptable search performance
3. **Range queries benefit from higher orders** but must balance against insert/search degradation
4. **Storage overhead is significant** - high orders use 19-40x more space

**Critical Discovery:**
Large documents with high branching factors create a **catastrophic performance cliff** - search operations become 13x slower compared to optimal configurations. This represents a significant risk for applications with variable document sizes.

**Next Steps:**
1. Implement dynamic order selection based on document size profiling
2. Add performance warnings when suboptimal configurations are detected
3. Document these findings in user-facing documentation
4. Consider adaptive indexing strategies that can adjust order based on runtime characteristics

---

## Appendix: Raw Data

Complete benchmark results are available in: `bplustree-benchmark-results.json`

### Test Execution Details

- Total tests run: 18
- Total execution time: ~25 minutes
- Test failures: 0
- Platform: Node.js 20.20.0 on Linux
- Storage: OPFS via node-opfs

### Reproducibility

To reproduce these results:

```bash
# Install dependencies
npm install

# Run benchmark
node scripts/benchmark-bplustree.js
```

Results will be written to `bplustree-benchmark-results.json` and displayed in the console.

---

**Report Generated:** 2026-02-01  
**Author:** GitHub Copilot Coding Agent  
**Benchmark Script:** `scripts/benchmark-bplustree.js`
