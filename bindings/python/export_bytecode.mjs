import { parse, exportBytecode } from '../../dist/esm/index.js';
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || '/tmp/match-bytecodes';
fs.mkdirSync(outDir, { recursive: true });

const grammars = {
  email: `wchar: any of (letter, digit, underscore, period, plus, hyphen)
label: one or more of (letter, digit, underscore, hyphen)
dots: label joined by period
domain: label then period then dots
main: one or more wchar then at then domain`,

  uri: `scheme char: any of (letter, digit, underscore)
path char: any character except (space, question, hash)
host char: any character except (slash, space, question, hash)
query char: any character except (space, hash)
frag char: any character except (space)
main: one or more scheme char then "://" then one or more host char then zero or more path char then optional (question then zero or more query char) then optional (hash then zero or more frag char)`,

  ip: `octet: between 1 and 3 digits
main: octet then period then octet then period then octet then period then octet`,
};

for (const [name, grammar] of Object.entries(grammars)) {
  const program = parse(grammar);
  const bytecode = exportBytecode(program);
  const outPath = path.join(outDir, `${name}.bin`);
  fs.writeFileSync(outPath, Buffer.from(bytecode));
  console.log(`${name}: ${bytecode.byteLength} bytes -> ${outPath}`);
}

console.log('\nDone. Use these .bin files with Python:\n');
console.log('  from match_lang import load_bytecode');
console.log('  prog = load_bytecode("/tmp/match-bytecodes/email.bin")');
console.log('  matches = prog.scan("hello user@example.com world")');
