const fs = require('fs');
const path = require('path');

const schemaPath = path.resolve(
  process.cwd(),
  'prisma/schema.prisma'
);

if (!fs.existsSync(schemaPath)) {
  console.error(
    '[ERROR] prisma/schema.prisma não encontrado.'
  );
  process.exit(1);
}

const original = fs.readFileSync(
  schemaPath,
  'utf8'
);

const generatorPattern =
  /generator\s+client\s*\{[\s\S]*?\}/m;

if (!generatorPattern.test(original)) {
  console.error(
    '[ERROR] Bloco generator client não encontrado.'
  );
  process.exit(1);
}

const replacement = `generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}`;

const updated = original.replace(
  generatorPattern,
  replacement
);

fs.copyFileSync(
  schemaPath,
  `${schemaPath}.backup`
);

fs.writeFileSync(
  schemaPath,
  updated
);

console.log(
  '✅ Prisma binaryTargets atualizado.'
);
