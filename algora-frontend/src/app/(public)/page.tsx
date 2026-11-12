import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  GitBranch,
  Layers3,
  Route,
  GraduationCap,
  Building2,
  Check,
  Terminal,
} from 'lucide-react';
import { Header, Brand } from '@/components/layout/header';
import { HealthIndicator } from '@/components/shared/health-indicator';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
export default function Home() {
  return (
    <>
      <Header />
      <main id="main">
        <section className="hero wrap">
          <div className="hero-copy">
            <Badge>
              <span className="dot" /> A stronger foundation. A clearer path.
            </Badge>
            <h1>
              Big ideas start
              <br />
              with a little
              <br />
              <span>logic.</span>
              <span className="hero-asterisk">✳</span>
            </h1>
            <p>
              A dedicated space to learn data structures, think in algorithms,
              and grow with every problem you solve.
            </p>
            <div className="hero-actions">
              <Button asChild>
                <Link href="/login">
                  Find your starting point <ArrowUpRight size={18} />
                </Link>
              </Button>
              <a href="#approach" className="text-link">
                Explore Algora <ArrowRight size={17} />
              </a>
            </div>
            <div className="hero-note">
              <span className="mini-line" /> Built for learning. Designed for
              growth.
            </div>
          </div>
          <div
            className="logic-art"
            aria-label="Illustration of a learning path from curiosity to clarity"
          >
            <div className="art-top">
              <span>
                <span className="dot" /> THE LEARNING MINDSET
              </span>
              <Braces size={18} />
            </div>
            <div className="art-grid">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="path-line" />
              <div className="logic-node node-one">
                <Braces />
                <span>01 / UNDERSTAND</span>
                <strong>Start with why.</strong>
              </div>
              <div className="logic-node node-two">
                <GitBranch />
                <span>02 / CONNECT</span>
                <strong>Find the pattern.</strong>
              </div>
              <div className="logic-node node-three">
                <Check />
                <span>03 / GROW</span>
                <strong>Make it click.</strong>
              </div>
              <span className="art-spark">✳</span>
              <span className="art-coordinate">curiosity → clarity</span>
            </div>
            <div className="art-bottom">
              <Terminal size={15} />
              <code>while (curious) &#123; keepGrowing(); &#125;</code>
              <span className="terminal-cursor" />
            </div>
          </div>
        </section>
        <section className="principles">
          <div className="wrap principles-inner">
            <span>
              A LITTLE STRUCTURE.
              <br />
              <strong>A lot of possibility.</strong>
            </span>
            <div>
              <Route /> Intentional learning paths
            </div>
            <div>
              <Braces /> Problem-first thinking
            </div>
            <div>
              <Layers3 /> One connected workspace
            </div>
          </div>
        </section>
        <section id="approach" className="section wrap">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE ALGORA APPROACH</span>
              <h2>
                Less scattered.
                <br />
                More <em>connected.</em>
              </h2>
            </div>
            <p>
              Learning DSA takes more than collecting resources. Algora is being
              built to bring direction, practice, and a sense of progress into
              one thoughtful space.
            </p>
          </div>
          <div id="platform" className="feature-grid">
            {[
              {
                icon: Route,
                n: '01',
                title: 'A path with purpose',
                text: 'A home for structured learning, with space for courses, batches, and daily learning journeys.',
              },
              {
                icon: Braces,
                n: '02',
                title: 'Think. Practice. Repeat.',
                text: 'A foundation for meaningful problem solving, where understanding comes before memorization.',
              },
              {
                icon: GitBranch,
                n: '03',
                title: 'Built to grow together',
                text: 'A shared direction for students and educators, designed to support multiple colleges as Algora grows.',
              },
            ].map((f) => (
              <Card key={f.n}>
                <div className="feature-top">
                  <f.icon size={25} />
                  <span>{f.n}</span>
                </div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                <span className="planned">
                  Platform vision · coming in future phases
                </span>
              </Card>
            ))}
          </div>
        </section>
        <section id="start" className="entry-section wrap">
          <div className="entry-intro">
            <span className="eyebrow">YOUR NEXT CHAPTER</span>
            <h2>
              Different roles.
              <br />
              One place to grow.
            </h2>
            <p>Choose your doorway into Algora.</p>
          </div>
          <Link href="/login?role=student" className="entry-card">
            <GraduationCap size={30} />
            <h3>I’m a student</h3>
            <p>
              Build the way you think.
              <br />
              One concept at a time.
            </p>
            <span>
              Student entry <ArrowUpRight size={20} />
            </span>
          </Link>
          <Link href="/login?role=admin" className="entry-card">
            <Building2 size={30} />
            <h3>I’m an educator</h3>
            <p>
              Make room for better learning.
              <br />
              Bring your community along.
            </p>
            <span>
              Admin entry <ArrowUpRight size={20} />
            </span>
          </Link>
        </section>
        <section className="closing wrap">
          <span className="closing-flower">✳</span>
          <h2>Great thinking grows here.</h2>
          <p>Wherever you’re starting, start with a strong foundation.</p>
          <Button asChild>
            <Link href="/login">
              Step into Algora <ArrowUpRight size={18} />
            </Link>
          </Button>
        </section>
      </main>
      <footer className="footer wrap">
        <div>
          <Brand />
          <p>Where Logic Grows</p>
        </div>
        <div>
          <span>Thoughtfully built for the learning journey.</span>
          <HealthIndicator />
          <small>Phase 1 · Platform foundation</small>
        </div>
      </footer>
    </>
  );
}
