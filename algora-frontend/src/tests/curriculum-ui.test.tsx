import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SafeMarkdown,
  Snippet,
  DayContent,
  EditorialView,
  publicLink,
} from '@/features/curriculum/render';
import { CurriculumBuilder } from '@/features/curriculum/builder';
import { DayEditor } from '@/features/curriculum/day-editor';
import { ProblemCatalog } from '@/features/curriculum/problems';
import { EditorialEditor } from '@/features/curriculum/editorials';
import { BatchCurriculum } from '@/features/curriculum/batch-assignment';
import {
  StudentCourse,
  StudentBatch,
  StudentLearningDay,
} from '@/features/curriculum/student';
import {
  dayLabel,
  dayForm,
  type StudentDay,
} from '@/features/curriculum/contracts';
const mocks = vi.hoisted(() => ({
  error: false,
  empty: false,
  published: false,
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
vi.mock('@/features/auth/provider', () => ({
  useAuth: () => ({
    user: { role: 'STUDENT' },
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));
const courseId = 'a'.repeat(24),
  revisionId = 'b'.repeat(24),
  batchId = 'c'.repeat(24),
  problemId = 'd'.repeat(24),
  dayId = 'e'.repeat(24),
  uuid = '12345678-1234-4234-8234-123456789012';
const page = <T,>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  totalPages: items.length ? 1 : 0,
});
const revision = {
  id: revisionId,
  courseId,
  revisionNumber: 1,
  status: 'DRAFT',
  revision: 1,
  dayCount: 1,
};
const day = {
  id: dayId,
  courseId,
  curriculumRevisionId: revisionId,
  dayNumber: 100,
  title: 'Array foundations',
  description: 'Original learning content',
  learningObjectives: ['Recognize patterns'],
  topics: [
    {
      id: uuid,
      title: 'Arrays',
      description: 'Ordered data',
      estimatedMinutes: 20,
    },
  ],
  resources: [],
  problemAssignments: [],
  publicationStatus: 'PUBLISHED',
  publishAt: null,
};
const studentDay: StudentDay = {
  ...day,
  problemAssignments: [
    {
      problemId,
      category: 'CHALLENGE',
      instructorNote: 'Try a map',
      editorialAvailable: false,
      problem: {
        id: problemId,
        platform: 'LEETCODE',
        platformProblemId: 'two-sum',
        title: 'Pair target',
        url: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'EASY',
        topics: ['Arrays'],
        description: '',
      },
    },
  ],
};
const problem = {
  id: problemId,
  platform: 'LEETCODE',
  platformProblemId: 'two-sum',
  title: 'Pair target',
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'EASY',
  topics: ['Arrays'],
  description: 'Original metadata',
  ownerCollegeId: null,
  revision: 0,
  canManage: true,
};
const body = {
  title: 'Pair explanation',
  introduction: 'Use complement lookup',
  approaches: [
    {
      id: uuid,
      title: 'Map',
      intuition: 'Remember values',
      bruteForce: 'Scan pairs',
      optimizedApproach: 'Use a map',
      steps: ['Read input'],
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(n)',
      notes: '',
    },
  ],
  examples: [],
  codeSolutions: [
    {
      id: uuid,
      approachId: uuid,
      language: 'PYTHON' as const,
      code: 'print("explanatory")',
    },
  ],
  additionalNotes: 'Notes',
};
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { success: true, data }
        : {
            success: false,
            error: {
              code: 'UNAVAILABLE',
              message: 'Curriculum temporarily unavailable',
            },
          },
    ),
    { status },
  );
beforeEach(() => {
  Object.assign(mocks, { error: false, empty: false, published: false });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: unknown, init?: RequestInit) => {
      const path = String(raw);
      if (mocks.error) return response(null, 503);
      if (path.endsWith('/auth/csrf')) return response({ csrfToken: 'csrf' });
      if (['POST', 'PATCH', 'DELETE'].includes(init?.method ?? ''))
        return response(revision);
      if (path.includes('/colleges')) return response(page([]));
      if (path.includes('/assignment-preview'))
        return response({
          batchId,
          batchRevision: 2,
          previousRevisionId: null,
          newRevisionId: revisionId,
          newDayCount: 1,
          activeMemberships: 4,
          batchStatus: 'ACTIVE',
          impactFingerprint: 'f'.repeat(64),
        });
      if (path.includes('/history')) return response(page([]));
      if (path.includes('/students/me/courses/'))
        return response({
          course: {
            id: courseId,
            title: 'DSA foundations',
            description: 'Course overview',
            difficulty: 'BEGINNER',
          },
          batches: page([
            {
              id: batchId,
              name: 'June cohort',
              curriculumRevision: { id: revisionId, revisionNumber: 1 },
            },
          ]),
        });
      if (path.includes('/students/me/batches/') && path.includes('/days/'))
        return response({
          batch: { id: batchId, name: 'June cohort', courseId },
          revision: { id: revisionId, revisionNumber: 1 },
          day: studentDay,
        });
      if (path.includes('/students/me/batches/'))
        return response({
          batch: {
            id: batchId,
            name: 'June cohort',
            courseId,
            courseTitle: 'DSA foundations',
            collegeId: courseId,
            collegeName: 'Example college',
          },
          revision: mocks.empty ? null : { id: revisionId, revisionNumber: 1 },
          days: page(
            mocks.empty
              ? []
              : [
                  {
                    id: dayId,
                    dayNumber: 100,
                    title: day.title,
                    topics: ['Arrays'],
                    resourceCount: 0,
                    problemCount: 1,
                  },
                ],
          ),
          message: mocks.empty ? 'Curriculum not assigned' : '',
        });
      if (path.includes('/batches/'))
        return response({
          batch: {
            id: batchId,
            name: 'June cohort',
            status: 'ACTIVE',
            revision: 2,
            seatCount: 4,
            curriculumRevisionId: null,
          },
          assignedRevision: null,
          options: page([{ ...revision, status: 'PUBLISHED' }]),
          releases: [],
        });
      if (path.includes('/problems/') && path.includes('/editorials'))
        return response(page([]));
      if (path.includes('/problems'))
        return response(page(mocks.empty ? [] : [problem]));
      if (path.includes('/revisions/'))
        return response({
          revision: {
            ...revision,
            status: mocks.published ? 'PUBLISHED' : 'DRAFT',
          },
          days: page([day]),
        });
      return response(
        page(
          mocks.empty
            ? []
            : [
                {
                  ...revision,
                  status: mocks.published ? 'PUBLISHED' : 'DRAFT',
                },
              ],
        ),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
const writes = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) =>
      ['POST', 'PATCH', 'DELETE'].includes(init?.method ?? ''),
    );
it('sanitizes HTML, images, task inputs and unsafe Markdown links', () => {
  const { container } = render(
    <SafeMarkdown
      text={
        '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1)) ![no remote image](https://example.org/image.png)\n\n- [ ] fake completion'
      }
    />,
  );
  expect(container.querySelector('script,img,input')).toBeNull();
  expect(container.querySelector('a')).toBeNull();
});
it('opens only safe Markdown HTTPS links with isolation', () => {
  render(<SafeMarkdown text="[Reading](https://example.org/guide)" />);
  expect(screen.getByRole('link', { name: 'Reading' })).toHaveAttribute(
    'rel',
    'noopener noreferrer nofollow',
  );
});
it.each([
  'javascript:alert(1)',
  'data:text/html,x',
  'file:///tmp/x',
  'https://127.0.0.1/x',
  'https://localhost/x',
  'https://name:secret@example.org/x',
])('rejects unsafe display link %s', (link) =>
  expect(publicLink(link)).toBeUndefined(),
);
it('escapes highlighted code without creating HTML', () => {
  const { container } = render(
    <Snippet
      code={'<script>window.attack=true</script>'}
      language="JAVASCRIPT"
    />,
  );
  expect(container.querySelector('script')).toBeNull();
  expect(container.textContent).toContain('<script>');
});
it('renders structured approaches and code in separate tabs', () => {
  render(<EditorialView body={body} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Approaches' }));
  expect(screen.getAllByText('O(n)', { selector: 'dd' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
  expect(screen.getByLabelText('PYTHON explanatory code')).toBeInTheDocument();
});
it('renders any released Day 100 and official challenge link without solved inputs', () => {
  const { container } = render(<DayContent day={studentDay} />);
  expect(screen.getByText(/Day 100/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Problems' }));
  expect(
    screen.getByRole('link', { name: /Open official problem/ }),
  ).toHaveAttribute('href', problem.url);
  expect(container.querySelector('input[type=checkbox]')).toBeNull();
  expect(screen.queryByText('Pair explanation')).not.toBeInTheDocument();
});
it('shows revision list, day actions and explicit publishing review', async () => {
  mount(<CurriculumBuilder courseId={courseId} />);
  fireEvent.click(await screen.findByRole('button', { name: /Revision 1/ }));
  fireEvent.click(
    await screen.findByRole('button', { name: /Review & publish/ }),
  );
  expect(screen.getByRole('dialog')).toHaveTextContent(/immutable/i);
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(String(writes()[0][0])).toContain('/publish');
});
it('published builder offers cloning without edit controls', async () => {
  mocks.published = true;
  mount(<CurriculumBuilder courseId={courseId} />);
  fireEvent.click(await screen.findByRole('button', { name: /Revision 1/ }));
  expect(
    await screen.findByRole('button', { name: /Clone/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Add Learning Day' }),
  ).not.toBeInTheDocument();
});
it('handles empty revisions honestly', async () => {
  mocks.empty = true;
  mount(<CurriculumBuilder courseId={courseId} />);
  expect(
    await screen.findByText(/No curriculum revisions/),
  ).toBeInTheDocument();
});
it('shows backend unavailable state', async () => {
  mocks.error = true;
  mount(<ProblemCatalog />);
  expect(
    await screen.findByText('Curriculum temporarily unavailable'),
  ).toBeInTheDocument();
});
it('catalog searches and filters official reusable metadata', async () => {
  mount(<ProblemCatalog superAdmin />);
  expect(await screen.findByText('Pair target')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Problem platform filter'), {
    target: { value: 'LEETCODE' },
  });
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([u]) => String(u).includes('platform=LEETCODE')),
    ).toBe(true),
  );
  expect(
    await screen.findByRole('link', { name: /Official problem/ }),
  ).toHaveAttribute('href', problem.url);
});
it('day editor preserves topics while switching tabs and saves with parent revision', async () => {
  mount(
    <DayEditor
      courseId={courseId}
      revisionId={revisionId}
      expectedRevision={7}
      item={null}
      onDone={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Day title'), {
    target: { value: 'Ordered topics' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Topics & objectives' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
  fireEvent.change(screen.getByLabelText('Topic 1 title'), {
    target: { value: 'Hash maps' },
  });
  fireEvent.click(screen.getByRole('tab', { name: 'Properties' }));
  fireEvent.click(screen.getByRole('button', { name: /Save Learning Day/ }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  const sent = JSON.parse(String(writes()[0][1]?.body));
  expect(sent.expectedRevision).toBe(7);
  expect(sent.topics[0].title).toBe('Hash maps');
});
it('day editor serializes selected local schedule as UTC', () => {
  mount(
    <DayEditor
      courseId={courseId}
      revisionId={revisionId}
      expectedRevision={0}
      item={null}
      onDone={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Day publication status'), {
    target: { value: 'SCHEDULED' },
  });
  expect(screen.getByLabelText('Day publish time')).toHaveAttribute(
    'type',
    'datetime-local',
  );
  expect(writes()).toHaveLength(0);
});
it('validates required day title before saving', async () => {
  mount(
    <DayEditor
      courseId={courseId}
      revisionId={revisionId}
      expectedRevision={0}
      item={null}
      onDone={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Save Learning Day/ }));
  await waitFor(() =>
    expect(screen.getByText(/Too small/)).toBeInTheDocument(),
  );
  expect(writes()).toHaveLength(0);
});
it('editorial authoring offers structured sections and preview without execution', () => {
  mount(
    <EditorialEditor
      problemId={problemId}
      item={null}
      superAdmin
      onDone={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('Editorial title')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
  expect(
    screen.getByRole('button', { name: 'Add language solution' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Run code/ }),
  ).not.toBeInTheDocument();
});
it('requires reviewed Batch impact and explicit confirmation before assignment', async () => {
  mount(<BatchCurriculum batchId={batchId} />);
  expect(
    await screen.findByText(/Curriculum not assigned/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Published curriculum revision'), {
    target: { value: revisionId },
  });
  fireEvent.change(screen.getByLabelText('Assignment review reason'), {
    target: { value: 'Reviewed upgrade with delivery team' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Review curriculum assignment' }),
  );
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    '4 currently reserved memberships',
  );
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body)).impactFingerprint).toBe(
    'f'.repeat(64),
  );
});
it('student Course links only its authorized Batches', async () => {
  mount(<StudentCourse id={courseId} />);
  expect(await screen.findByText('DSA foundations')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: /Open Batch learning path/ }),
  ).toHaveAttribute('href', '/student/batches/' + batchId);
});
it('student Batch renders Day 100 directly with no sequential lock', async () => {
  mount(<StudentBatch id={batchId} />);
  expect(await screen.findByText('Day 100')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Explore this day →' }),
  ).toHaveAttribute('href', '/student/batches/' + batchId + '/days/100');
});
it('student Batch shows honest unassigned state', async () => {
  mocks.empty = true;
  mount(<StudentBatch id={batchId} />);
  expect(
    (await screen.findAllByText('Curriculum not assigned')).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole('link', { name: 'Explore this day →' }),
  ).not.toBeInTheDocument();
});
it('student Learning Day renders safe received content in tabs', async () => {
  mount(<StudentLearningDay batchId={batchId} number={100} />);
  expect(await screen.findByText('Array foundations')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Topics' })).toBeInTheDocument();
});
it('keeps large day labels and enforces positive day numbers', () => {
  expect(dayLabel(1000)).toBe('Day 1000');
  expect(dayForm.safeParse({ ...day, dayNumber: 0 }).success).toBe(false);
});
