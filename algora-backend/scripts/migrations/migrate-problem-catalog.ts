import mongoose from 'mongoose';
import { CatalogProblem, Problem } from '../../src/models';
import { parseLeetCodeUrl } from '../../src/lib/leetcodeUrl';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  if (apply) await CatalogProblem.createIndexes();
  const counts = { scanned: 0, newEntries: 0, linkedAssignments: 0, invalidAssignments: 0, metadataDifferences: 0 };
  const entries = new Map<string, { _id?: mongoose.Types.ObjectId; title: string; difficulty: string }>();
  for await (const entry of CatalogProblem.find().select('slug title difficulty').lean().cursor()) entries.set(entry.slug, entry);
  for await (const assignment of Problem.find().sort({ createdAt: 1, _id: 1 }).lean().cursor()) {
    counts.scanned++;
    let canonical;
    try { canonical = parseLeetCodeUrl(assignment.url); }
    catch { counts.invalidAssignments++; continue; }
    if (canonical.slug !== assignment.slug) { counts.invalidAssignments++; continue; }
    let entry = entries.get(assignment.slug);
    if (!entry) {
      const metadata = {
        ...canonical, title: assignment.title, titleKey: assignment.title.trim().toLowerCase().replace(/\s+/g, ' '),
        difficulty: assignment.difficulty, source: 'EXISTING_ASSIGNMENT', metadataStatus: 'PARTIAL' as const,
      };
      entry = apply ? await CatalogProblem.findOneAndUpdate(
        { slug: assignment.slug }, { $setOnInsert: metadata },
        { upsert: true, returnDocument: 'after' },
      ).lean() : metadata;
      entries.set(assignment.slug, entry);
      counts.newEntries++;
    }
    if (entry.title !== assignment.title || entry.difficulty !== assignment.difficulty) counts.metadataDifferences++;
    if (assignment.catalogId) continue;
    if (apply) {
      const result = await Problem.updateOne(
        { _id: assignment._id, slug: assignment.slug, catalogId: null },
        { $set: { catalogId: entry._id } }, { timestamps: false },
      );
      counts.linkedAssignments += result.modifiedCount;
    } else counts.linkedAssignments++;
  }
  console.log(JSON.stringify({ applied: apply, ...counts }, null, 2));
}

main().catch((error: unknown) => {
  console.error('Catalog migration failed', error instanceof Error ? error.name : 'Unknown error');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
