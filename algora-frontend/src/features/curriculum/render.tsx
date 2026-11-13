'use client';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Highlight, themes } from 'prism-react-renderer';
import { Button } from '@/components/ui/button';
import { Status } from '@/components/shared/admin-ui';
import { editorialBody, type StudentDay, dayLabel } from './contracts';
import type { z } from 'zod';
export function publicLink(value: string) {
  try {
    const u = new URL(value),
      host = u.hostname;
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      !host.includes('.') ||
      /^\[|^[\d.]+$|(^|\.)(localhost|local|internal)$/.test(host)
    )
      return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}
export function SafeMarkdown({ text }: { text: string }) {
  return (
    <div className="curriculum-markdown">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) =>
            publicLink(href ?? '') ? (
              <a
                href={publicLink(href!)}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          input: () => null,
          img: ({ alt }) => <span>{alt ?? 'Image omitted'}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
export function Snippet({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const lang =
    (
      {
        JAVA: 'java',
        PYTHON: 'python',
        CPP: 'cpp',
        JAVASCRIPT: 'javascript',
      } as Record<string, string>
    )[language] ?? 'text';
  return (
    <Highlight theme={themes.nightOwl} code={code} language={lang}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={'curriculum-code ' + className}
          style={style}
          aria-label={language + ' explanatory code'}
        >
          <code>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, j) => (
                  <span key={j} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}
export function EditorialView({
  body,
}: {
  body: z.infer<typeof editorialBody>;
}) {
  const [section, setSection] = useState('Overview');
  const choices = ['Overview', 'Approaches', 'Walkthroughs', 'Code', 'Notes'];
  return (
    <section className="editorial-view">
      <h2>{body.title}</h2>
      <div
        className="learning-tabs"
        role="tablist"
        aria-label="Editorial sections"
      >
        {choices.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={section === v}
            onClick={() => setSection(v)}
          >
            {v}
          </button>
        ))}
      </div>
      {section === 'Overview' && (
        <SafeMarkdown text={body.introduction || 'No introduction provided.'} />
      )}{' '}
      {section === 'Approaches' &&
        body.approaches.map((a, i) => (
          <article className="curriculum-section" key={a.id}>
            <span className="eyebrow">APPROACH {i + 1}</span>
            <h3>{a.title}</h3>
            {[
              ['Intuition', a.intuition],
              ['Brute-force approach', a.bruteForce],
              ['Optimized approach', a.optimizedApproach],
            ].map(
              ([title, value]) =>
                value && (
                  <section key={title}>
                    <h4>{title}</h4>
                    <SafeMarkdown text={value} />
                  </section>
                ),
            )}
            {a.steps.length > 0 && (
              <ol>
                {a.steps.map((step, k) => (
                  <li key={k}>
                    <SafeMarkdown text={step} />
                  </li>
                ))}
              </ol>
            )}
            <dl className="student-grid">
              <div>
                <dt>Time complexity</dt>
                <dd>{a.timeComplexity || 'Not specified'}</dd>
              </div>
              <div>
                <dt>Space complexity</dt>
                <dd>{a.spaceComplexity || 'Not specified'}</dd>
              </div>
            </dl>
            <SafeMarkdown text={a.notes} />
          </article>
        ))}
      {section === 'Walkthroughs' &&
        (body.examples.length ? (
          body.examples.map((e, i) => (
            <article key={e.id} className="curriculum-section">
              <h3>Example {i + 1}</h3>
              <h4>Input</h4>
              <pre className="curriculum-plain-code">{e.input}</pre>
              <h4>Output</h4>
              <pre className="curriculum-plain-code">{e.output}</pre>
              <SafeMarkdown text={e.walkthrough} />
            </article>
          ))
        ) : (
          <p>No walkthroughs provided.</p>
        ))}
      {section === 'Code' && (
        <>
          {body.codeSolutions.length === 0 && (
            <p>No code snippets published.</p>
          )}
          {body.codeSolutions.map((c) => (
            <article key={c.id}>
              <h3>
                {body.approaches.find((a) => a.id === c.approachId)?.title} ·{' '}
                {c.language}
              </h3>
              <Snippet code={c.code} language={c.language} />
            </article>
          ))}
          <p>
            Instructor-authored explanatory snippets. No code is executed here.
          </p>
        </>
      )}
      {section === 'Notes' && (
        <SafeMarkdown text={body.additionalNotes || 'No additional notes.'} />
      )}
    </section>
  );
}
export function DayContent({ day }: { day: StudentDay }) {
  const [section, setSection] = useState('Overview'),
    [editorial, setEditorial] = useState<string | null>(null);
  const sections = ['Overview', 'Topics', 'Resources', 'Problems'];
  return (
    <article className="learning-day-content">
      <span className="eyebrow">{dayLabel(day.dayNumber)}</span>
      <h1>{day.title}</h1>
      <div
        className="learning-tabs"
        role="tablist"
        aria-label="Learning Day sections"
      >
        {sections.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={section === v}
            onClick={() => setSection(v)}
          >
            {v}
          </button>
        ))}
      </div>
      {section === 'Overview' && (
        <section className="student-card">
          <SafeMarkdown text={day.description} />
          <h2>Learning objectives</h2>
          {day.learningObjectives.length ? (
            <ol>
              {day.learningObjectives.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ol>
          ) : (
            <p>No objectives listed.</p>
          )}
          <p>
            You may access any released day. There is no sequential completion
            or solved-state tracking.
          </p>
        </section>
      )}
      {section === 'Topics' && (
        <section className="student-card">
          <h2>Topics</h2>
          {day.topics.length ? (
            day.topics.map((t, i) => (
              <article key={t.id} className="curriculum-section">
                <h3>
                  {i + 1}. {t.title}
                </h3>
                {t.estimatedMinutes && (
                  <p>Suggested reading: {t.estimatedMinutes} minutes</p>
                )}
                <SafeMarkdown text={t.description} />
              </article>
            ))
          ) : (
            <p>No topics listed.</p>
          )}
        </section>
      )}
      {section === 'Resources' && (
        <section className="student-card">
          <h2>Learning resources</h2>
          {day.resources.length ? (
            day.resources.map((r) => (
              <article key={r.id} className="curriculum-section">
                <Status value={r.type} />
                <h3>{r.title}</h3>
                <p>{r.description}</p>
                {r.notes && <SafeMarkdown text={r.notes} />}{' '}
                {r.url && publicLink(r.url) && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    Open external resource ↗
                  </a>
                )}
              </article>
            ))
          ) : (
            <p>No student resources released.</p>
          )}
        </section>
      )}
      {section === 'Problems' && (
        <section>
          {(['REQUIRED', 'OPTIONAL', 'CHALLENGE'] as const).map((category) => (
            <section key={category} className="student-card">
              <span className="eyebrow">{category}</span>
              <h2>
                {category === 'CHALLENGE'
                  ? 'Stretch your thinking'
                  : category === 'OPTIONAL'
                    ? 'Keep exploring'
                    : 'Core practice'}
              </h2>
              {day.problemAssignments
                .filter((a) => a.category === category)
                .map((a) => (
                  <article className="problem-card" key={a.problemId}>
                    <div>
                      <Status value={a.problem.difficulty} />
                      <span className="problem-platform">
                        {a.problem.platform}
                      </span>
                    </div>
                    <h3>{a.problem.title}</h3>
                    <SafeMarkdown text={a.problem.description} />
                    {a.instructorNote && <p>{a.instructorNote}</p>}
                    <div className="student-actions">
                      <a
                        href={a.problem.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                      >
                        Open official problem ↗
                      </a>
                      {a.editorial && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            setEditorial(
                              editorial === a.problemId ? null : a.problemId,
                            )
                          }
                        >
                          {editorial === a.problemId
                            ? 'Close editorial'
                            : 'Read editorial'}
                        </Button>
                      )}
                    </div>
                    {editorial === a.problemId && a.editorial && (
                      <EditorialView body={a.editorial.body} />
                    )}
                  </article>
                ))}
              {!day.problemAssignments.some((a) => a.category === category) && (
                <p>No {category.toLowerCase()} problems assigned.</p>
              )}
            </section>
          ))}
          <p>
            External problems are practice links. Opening a link does not record
            a solved state or verify a submission.
          </p>
        </section>
      )}
    </article>
  );
}
