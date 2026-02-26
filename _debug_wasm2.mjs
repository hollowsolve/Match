import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// We need to call buildVmWasm - but it's not exported. Let's add a temp export or just inline the test.
// Instead, let's modify vm-exec to export buildVmWasm temporarily and rebuild.
// Actually, let's just test by reading the built module and validating

// Simpler: replicate the WASM binary generation from the CJS build and catch the error
const mod = require('./dist/cjs/executor/vm-exec.js');
console.log('Exports:', Object.keys(mod));

// The ensureVm function catches errors silently. Let's manually test.
// We need access to buildVmWasm. Let's add it as an export.
