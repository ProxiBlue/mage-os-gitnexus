// Apply OOM fixes for large PHP vendor trees
// Upstream: https://github.com/abhigyanpatwari/GitNexus/issues/1741
// PRs: #1800, #1808
const fs = require('fs');
const GITNEXUS = '/usr/local/lib/node_modules/gitnexus/dist';

// Fix 1: Filter registry-primary calls from deferred accumulation (PR #1800)
const parseImpl = `${GITNEXUS}/core/ingestion/pipeline-phases/parse-impl.js`;
let pi = fs.readFileSync(parseImpl, 'utf-8');
const oldCall = 'for (const item of chunkWorkerData.calls)\n                    deferredWorkerCalls.push(item);';
const altCall = 'for (const item of chunkWorkerData.calls) deferredWorkerCalls.push(item);';
const newCall = `for (const item of chunkWorkerData.calls) {
                    const _l = getLanguageFromFilename(item.filePath);
                    if (_l && isRegistryPrimary(_l)) continue;
                    deferredWorkerCalls.push(item);
                }`;
if (pi.includes(oldCall)) { pi = pi.replace(oldCall, newCall); }
else if (pi.includes(altCall)) { pi = pi.replace(altCall, newCall); }

// Add isRegistryPrimary import if not present
if (!pi.includes('isRegistryPrimary')) {
  pi = pi.replace(
    "import { isDev } from '../utils/env.js';",
    "import { isDev } from '../utils/env.js';\nimport { isRegistryPrimary } from '../registry-primary-flag.js';"
  );
}
fs.writeFileSync(parseImpl, pi);
console.log('Patched parse-impl.js: filter registry-primary calls');

// Fix 2: Namespace siblings demand-driven FQN + Map lookup (PR #1808)
const nsSiblings = `${GITNEXUS}/core/ingestion/languages/php/namespace-siblings.js`;
let ns = fs.readFileSync(nsSiblings, 'utf-8');

// Replace Step 3b (O(files × classDefs) → demand-driven)
const step3bMarker = '// Step 3b: Inject fully-qualified-name bindings into every PHP file';
if (ns.includes(step3bMarker) && !ns.includes('referencedFqns')) {
  const step3bStart = ns.indexOf(step3bMarker);
  const step4Marker = '// Step 4:';
  const step3bEnd = ns.indexOf(step4Marker);
  if (step3bEnd > step3bStart) {
    const newStep3b = `// Step 3b: Demand-driven FQN augmentation (patched for OOM fix #1803)
    const fqnDefs = new Map();
    for (const [ns2, bucket2] of buckets) {
        if (ns2 === '') continue;
        for (const def of bucket2.classDefs) {
            const q = def.qualifiedName ?? '';
            const simpleName = q.includes('\\\\') ? q.slice(q.lastIndexOf('\\\\') + 1) : q;
            if (simpleName === '') continue;
            const fqn = ns2 + '\\\\' + simpleName;
            let arr = fqnDefs.get(fqn);
            if (!arr) { arr = []; fqnDefs.set(fqn, arr); }
            arr.push(def);
        }
    }
    for (const parsed of parsedFiles) {
        const moduleScope = parsed.scopes.find((s) => s.kind === 'Module');
        if (moduleScope === undefined) continue;
        const moduleScopeId = moduleScope.id;
        const referencedFqns = new Set();
        for (const ref of parsed.referenceSites) {
            if (ref.name && ref.name.includes('\\\\')) referencedFqns.add(ref.name);
        }
        for (const scope of parsed.scopes) {
            for (const [name] of scope.typeBindings) {
                if (name.includes('\\\\')) referencedFqns.add(name);
            }
        }
        for (const imp of parsed.parsedImports) {
            if (imp.targetRaw && imp.targetRaw.includes('\\\\')) referencedFqns.add(imp.targetRaw);
        }
        for (const name of referencedFqns) {
            const cleanName = name.startsWith('\\\\') ? name.slice(1) : name;
            const defs = fqnDefs.get(cleanName);
            if (!defs) continue;
            for (const def of defs) {
                const arr = getAugmentationBucket(augmentations, moduleScopeId, cleanName);
                if (arr.some((b) => b.def.nodeId === def.nodeId)) continue;
                arr.push({ def, origin: 'namespace' });
            }
        }
    }
    `;
    ns = ns.substring(0, step3bStart) + newStep3b + ns.substring(step3bEnd);
  }
}

// Replace parsedFiles.find() with Map lookup in Step 4
if (ns.includes('parsedFiles.find((p) => p.filePath === srcFilePath)') || ns.includes('parsedFiles.find((p)=>p.filePath===srcFilePath)')) {
  // Add map before step 4
  const step4 = ns.indexOf('// Step 4:');
  if (step4 > 0) {
    const mapInsert = 'const parsedByPath = new Map();\n    for (const p of parsedFiles) parsedByPath.set(p.filePath, p);\n    ';
    ns = ns.substring(0, step4) + mapInsert + ns.substring(step4);
    ns = ns.replace(/parsedFiles\.find\(\(p\)\s*=>\s*p\.filePath\s*===\s*srcFilePath\)/g, 'parsedByPath.get(srcFilePath)');
  }
}

fs.writeFileSync(nsSiblings, ns);
console.log('Patched namespace-siblings.js: demand-driven FQN + Map lookup');
