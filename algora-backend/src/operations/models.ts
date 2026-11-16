import type { Model } from 'mongoose';
import * as m0 from '../models/admin-access-request.js';
import * as m1 from '../models/admin-college-assignment.js';
import * as m2 from '../models/attendance.js';
import * as m3 from '../models/audit-log.js';
import * as m4 from '../models/coding.js';
import * as m5 from '../models/college.js';
import * as m6 from '../models/curriculum.js';
import * as m7 from '../models/learning.js';
import * as m8 from '../models/oauth-transaction.js';
import * as m9 from '../models/session.js';
import * as m10 from '../models/student-profile-correction-request.js';
import * as m11 from '../models/student-profile.js';
import * as m12 from '../models/student-qr-credential.js';
import * as m13 from '../models/user.js';
const exported: unknown[] = [
  ...Object.values(m0),
  ...Object.values(m1),
  ...Object.values(m2),
  ...Object.values(m3),
  ...Object.values(m4),
  ...Object.values(m5),
  ...Object.values(m6),
  ...Object.values(m7),
  ...Object.values(m8),
  ...Object.values(m9),
  ...Object.values(m10),
  ...Object.values(m11),
  ...Object.values(m12),
  ...Object.values(m13),
];
const isModel = (v: unknown): v is Model<object> =>
  typeof v === 'function' && 'modelName' in v && 'schema' in v;
export const applicationModels = [
  ...new Map(exported.filter(isModel).map((m) => [m.modelName, m])).values(),
];
