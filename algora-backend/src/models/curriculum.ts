import { Schema, model } from 'mongoose';
import { AppError } from '../middleware/app-error.js';
import { dayStatuses, platforms } from '../curriculum/contracts.js';
const ref = (name: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
});
const options = {
  timestamps: true,
  strict: 'throw' as const,
  autoIndex: false,
};
const revision = new Schema(
  {
    courseId: { ...ref('Course'), immutable: true },
    revisionNumber: { type: Number, required: true, min: 1, immutable: true },
    status: {
      type: String,
      enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
      required: true,
    },
    sourceRevisionId: { ...ref('CurriculumRevision', false), immutable: true },
    revision: { type: Number, required: true, default: 0, min: 0 },
    courseSnapshot: { type: Schema.Types.Mixed },
    dayCount: { type: Number, required: true, default: 0 },
    createdBy: { ...ref('User'), immutable: true },
    publishedBy: ref('User', false),
    publishedAt: Date,
  },
  options,
);
function draftOnly(schema: Schema) {
  for (const op of [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'replaceOne',
    'findOneAndReplace',
  ] as const)
    schema.pre(op, function () {
      if (
        this.getFilter().status !== 'DRAFT' ||
        !this.getFilter()._id ||
        typeof this.getFilter().revision !== 'number'
      )
        throw new AppError(
          409,
          'IMMUTABLE_CONTENT',
          'Published records cannot be changed',
        );
    });
  schema.pre('save', function () {
    if (!this.isNew)
      throw new AppError(
        409,
        'GUARDED_WRITE_REQUIRED',
        'Use revision-guarded draft writes',
      );
  });
}
draftOnly(revision);
revision.index({ courseId: 1, revisionNumber: 1 }, { unique: true });
revision.index({ courseId: 1, status: 1, revisionNumber: -1 });
export const CurriculumRevision = model('CurriculumRevision', revision);
const day = new Schema(
  {
    courseId: { ...ref('Course'), immutable: true },
    curriculumRevisionId: { ...ref('CurriculumRevision'), immutable: true },
    dayNumber: { type: Number, required: true, min: 1, max: 1000000000 },
    title: { type: String, required: true, maxlength: 180 },
    description: { type: String, default: '', maxlength: 12000 },
    learningObjectives: { type: [String], default: [] },
    topics: { type: [Schema.Types.Mixed], default: [] },
    resources: { type: [Schema.Types.Mixed], default: [] },
    problemAssignments: { type: [Schema.Types.Mixed], default: [] },
    publicationStatus: { type: String, enum: dayStatuses, required: true },
    publishAt: { type: Date, default: null },
    createdBy: { ...ref('User'), immutable: true },
    updatedBy: ref('User'),
  },
  options,
);
day.index({ curriculumRevisionId: 1, dayNumber: 1 }, { unique: true });
day.index({ curriculumRevisionId: 1, publicationStatus: 1, publishAt: 1 });
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'replaceOne',
  'findOneAndReplace',
] as const)
  day.pre(op, async function () {
    const parent = this.getFilter().curriculumRevisionId;
    if (
      !parent ||
      !(await CurriculumRevision.exists({
        _id: parent,
        status: 'DRAFT',
      }).session(this.getOptions().session ?? null))
    )
      throw new AppError(
        409,
        'IMMUTABLE_CONTENT',
        'Only guarded draft days can be changed',
      );
  });
day.pre('save', async function () {
  if (
    !(await CurriculumRevision.exists({
      _id: this.curriculumRevisionId,
      status: 'DRAFT',
    }).session(this.$session()))
  )
    throw new AppError(
      409,
      'IMMUTABLE_CONTENT',
      'Only draft learning days can be saved',
    );
});
export const LearningDay = model('LearningDay', day);
const frozen = new Schema(
  {
    curriculumRevisionId: { ...ref('CurriculumRevision'), immutable: true },
    courseId: { ...ref('Course'), immutable: true },
    dayNumber: { type: Number, required: true, immutable: true },
    dayId: { ...ref('LearningDay'), immutable: true },
    data: { type: Schema.Types.Mixed, required: true, immutable: true },
  },
  { strict: 'throw', autoIndex: false },
);
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'replaceOne',
  'findOneAndReplace',
] as const)
  frozen.pre(op, function () {
    throw new AppError(
      409,
      'IMMUTABLE_CONTENT',
      'Published day snapshots are append-only',
    );
  });
frozen.pre('save', async function () {
  if (!this.isNew)
    throw new AppError(
      409,
      'IMMUTABLE_CONTENT',
      'Published snapshots are immutable',
    );
  if (
    !(await CurriculumRevision.exists({
      _id: this.curriculumRevisionId,
      status: 'DRAFT',
    }).session(this.$session()))
  )
    throw new AppError(
      409,
      'IMMUTABLE_CONTENT',
      'Snapshots can only be created during draft publication',
    );
});
frozen.pre('insertMany', function () {
  throw new AppError(
    409,
    'GUARDED_WRITE_REQUIRED',
    'Use guarded snapshot creation',
  );
});
frozen.index({ curriculumRevisionId: 1, dayNumber: 1 }, { unique: true });
frozen.index({ curriculumRevisionId: 1, dayId: 1 }, { unique: true });
export const PublishedLearningDay = model('PublishedLearningDay', frozen);
const problem = new Schema(
  {
    platform: {
      type: String,
      enum: platforms,
      required: true,
      immutable: true,
    },
    platformProblemId: { type: String, required: true, immutable: true },
    url: { type: String, required: true, immutable: true },
    title: { type: String, required: true, maxlength: 180 },
    difficulty: {
      type: String,
      enum: ['EASY', 'MEDIUM', 'HARD', 'UNKNOWN'],
      required: true,
    },
    topics: { type: [String], default: [] },
    description: { type: String, default: '', maxlength: 10000 },
    ownerCollegeId: {
      ...ref('College', false),
      default: null,
      immutable: true,
    },
    revision: { type: Number, default: 0, required: true },
    operationalRevision: { type: Number, default: 0 },
    createdBy: { ...ref('User'), immutable: true },
    updatedBy: ref('User'),
  },
  options,
);
problem.index({ platform: 1, platformProblemId: 1 }, { unique: true });
problem.index({ platform: 1, difficulty: 1 });
problem.index({ title: 1, topics: 1 });
export const CodingProblem = model('CodingProblem', problem);
const editorial = new Schema(
  {
    problemId: { ...ref('CodingProblem'), immutable: true },
    versionNumber: { type: Number, required: true, min: 1, immutable: true },
    sourceEditorialId: { ...ref('EditorialRevision', false), immutable: true },
    ownerCollegeId: {
      ...ref('College', false),
      default: null,
      immutable: true,
    },
    status: { type: String, enum: ['DRAFT', 'PUBLISHED'], required: true },
    body: { type: Schema.Types.Mixed, required: true },
    revision: { type: Number, required: true, default: 0 },
    createdBy: { ...ref('User'), immutable: true },
    publishedBy: ref('User', false),
    publishedAt: Date,
  },
  options,
);
draftOnly(editorial);
editorial.index({ problemId: 1, versionNumber: 1 }, { unique: true });
editorial.index({ problemId: 1, ownerCollegeId: 1, status: 1 });
export const EditorialRevision = model('EditorialRevision', editorial);
const history = new Schema(
  {
    batchId: { ...ref('Batch'), immutable: true },
    previousRevisionId: {
      ...ref('CurriculumRevision', false),
      default: null,
      immutable: true,
    },
    newRevisionId: { ...ref('CurriculumRevision'), immutable: true },
    actorUserId: { ...ref('User'), immutable: true },
    reason: { type: String, required: true, immutable: true },
    activeMemberships: { type: Number, required: true, immutable: true },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { strict: 'throw', autoIndex: false },
);
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'replaceOne',
  'findOneAndReplace',
] as const)
  history.pre(op, function () {
    throw new AppError(
      409,
      'IMMUTABLE_CONTENT',
      'Assignment history is append-only',
    );
  });
history.index({ batchId: 1, createdAt: -1 });
history.index({ newRevisionId: 1 });
export const BatchCurriculumAssignmentHistory = model(
  'BatchCurriculumAssignmentHistory',
  history,
);
const release = new Schema(
  {
    batchId: { ...ref('Batch'), immutable: true },
    curriculumRevisionId: { ...ref('CurriculumRevision'), immutable: true },
    dayId: { ...ref('LearningDay'), immutable: true },
    restricted: { type: Boolean, required: true },
    revision: { type: Number, required: true, default: 0 },
    reason: { type: String, required: true, maxlength: 1000 },
    updatedBy: ref('User'),
  },
  options,
);
release.index(
  { batchId: 1, curriculumRevisionId: 1, dayId: 1 },
  { unique: true },
);
export const CurriculumReleaseControl = model(
  'CurriculumReleaseControl',
  release,
);
