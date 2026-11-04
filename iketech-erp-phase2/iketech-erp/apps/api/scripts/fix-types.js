// pg is configured to parse int8 as JS number (safe up to ₦90 trillion in kobo) and numeric as number.
const fs = require('fs');
const f = __dirname + '/../src/db/types.ts';
let s = fs.readFileSync(f, 'utf8');
s = s.replace(/export type Int8 = ColumnType<string,/, 'export type Int8 = ColumnType<number,')
     .replace(/export type Numeric = ColumnType<string,/, 'export type Numeric = ColumnType<number,');
fs.writeFileSync(f, s);
