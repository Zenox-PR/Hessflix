// Outil de génération uniquement : aucune dépendance Sharp dans le serveur ou le navigateur.
// Fournir Sharp via NODE_PATH s'il n'est pas installé dans l'environnement de développement.
const fs = require('node:fs/promises');
const path = require('node:path');
let sharp;
try { sharp = require('sharp'); }
catch {
  console.error('Sharp est un outil de génération facultatif. Fournissez son emplacement via NODE_PATH pour régénérer les variantes ; le site utilise les fichiers déjà générés sans cette dépendance.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const originals = path.join(root, 'assets', 'avatars');
const variants = path.join(root, 'assets', 'avatar-thumbnails');

async function pngFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await pngFiles(filename));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) result.push(filename);
  }
  return result;
}

(async () => {
  const files = await pngFiles(originals);
  let cursor = 0, originalBytes = 0, variantBytes = 0, converted = 0;
  async function worker() {
    while (cursor < files.length) {
      const input = files[cursor++];
      const relative = path.relative(originals, input);
      const output = path.join(variants, relative.replace(/\.png$/i, '.webp'));
      if (!output.startsWith(variants + path.sep)) throw new Error('Chemin de variante invalide');
      await fs.mkdir(path.dirname(output), { recursive: true });
      const info = await sharp(input)
        .resize({ width: 192, height: 192, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, alphaQuality: 90, effort: 4 })
        .toFile(output);
      const sourceInfo = await fs.stat(input);
      originalBytes += sourceInfo.size;
      variantBytes += info.size;
      converted++;
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(JSON.stringify({ files: converted, originalBytes, variantBytes, reductionPercent: Number((100 * (1 - variantBytes / originalBytes)).toFixed(2)), originalFilesPreserved: true, maxDimension: 192 }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
