import { openDB } from '../src/store/db.ts';
import { WorkbenchStore, dirItem } from '../src/workbench/store.ts';
const path = process.argv[2];
if (!path) throw new Error('path required');
const db = openDB(path);
new WorkbenchStore(db).record(dirItem('/writer/' + process.argv[3]));
db.close();
