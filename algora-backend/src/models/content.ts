import { Schema, model, Types } from 'mongoose';

const oid = (ref: string, required = true) => ({ type: Types.ObjectId, ref, required });

export const Course = model(
  'Course',
  new Schema(
    {
      title: { type: String, required: true, trim: true },
      description: { type: String, default: '' },
      status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT' },
      createdBy: oid('User'),
    },
    { timestamps: true },
  ),
  'courses',
);

const chapterSchema = new Schema(
  {
    courseId: oid('Course'),
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    order: { type: Number, required: true },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
chapterSchema.index({ courseId: 1, status: 1, order: 1 });
export const Chapter = model('Chapter', chapterSchema, 'chapters');

const catalogSchema = new Schema(
  {
    problemNumber: Number,
    title: { type: String, required: true },
    titleKey: { type: String, required: true },
    slug: { type: String, required: true },
    url: { type: String, required: true },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'], required: true },
    topics: { type: [String], default: [] },
    isPremium: Boolean,
    source: { type: String, required: true },
    metadataStatus: { type: String, enum: ['PARTIAL', 'AVAILABLE'], required: true },
  },
  { timestamps: true },
);
catalogSchema.index({ slug: 1 }, { unique: true });
catalogSchema.index({ problemNumber: 1 }, { unique: true, partialFilterExpression: { problemNumber: { $type: 'number' } } });
catalogSchema.index({ titleKey: 1 });
catalogSchema.index({ topics: 1 });
catalogSchema.index({ difficulty: 1, isPremium: 1 });
export const CatalogProblem = model('CatalogProblem', catalogSchema, 'problem_catalog');

const problemSchema = new Schema(
  {
    chapterId: oid('Chapter'),
    catalogId: oid('CatalogProblem', false),
    courseId: oid('Course'), // denormalised for course-level queries
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    slug: { type: String, required: true, lowercase: true },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'], required: true },
    order: { type: Number, required: true },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
  },
  { timestamps: true },
);
// Same slug may appear in different chapters, never twice (active) in one chapter.
problemSchema.index({ chapterId: 1, slug: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } });
problemSchema.index({ chapterId: 1, status: 1, order: 1 });
problemSchema.index({ courseId: 1, slug: 1 });
export const Problem = model('Problem', problemSchema, 'problems');

const bcSchema = new Schema(
  {
    batchId: oid('Batch'),
    courseId: oid('Course'),
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    assignedBy: oid('User'),
    assignedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
bcSchema.index({ batchId: 1, courseId: 1 }, { unique: true });
bcSchema.index({ courseId: 1, status: 1 });
export const BatchCourse = model('BatchCourse', bcSchema, 'batch_courses');

const accessSchema = new Schema(
  {
    batchCourseId: oid('BatchCourse'),
    chapterId: oid('Chapter'),
    isVisible: { type: Boolean, default: false },
    unlockedAt: Date,
    unlockedBy: oid('User', false),
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);
accessSchema.index({ batchCourseId: 1, chapterId: 1 }, { unique: true });
export const BatchChapterAccess = model('BatchChapterAccess', accessSchema, 'batch_chapter_access');
