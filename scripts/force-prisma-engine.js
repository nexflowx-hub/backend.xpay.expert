const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(
  process.cwd(),
  'prisma/schema.prisma'
);

if (!fs.existsSync(schemaPath)) {
  console.error('schema.prisma não encontrado.');
  process.exit(1);
}

const schema = fs.readFileSync(schemaPath, 'utf8');

const generatorRegex =
  /generator\s+client\s*\{[\s\S]*?\}/m;

if (!generatorRegex.test(schema)) {
  console.error(
    'Bloco generator client não encontrado.'
  );
  process.exit(1);
}

const generator = `generator client {
  provider      = "prisma-client-js"
  binaryTargets = [
    "native",
    "debian-openssl-1.1.x",
    "debian-openssl-3.0.x"
  ]
}`;

const updated = schema.replace(
  generatorRegex,
  generator
);

fs.writeFileSync(schemaPath, updated);

console.log(
  'Prisma configurado para OpenSSL 1.1 e OpenSSL 3.'
);
