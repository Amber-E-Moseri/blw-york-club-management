import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PostCard } from '../components/cards';
import { PageHero } from '../components/PageHero';
import { Chip, EmptyState, ImagePlaceholder, Section, SectionHeading, SampleTag } from '../components/ui';
import { useSiteContent } from '../content/SiteContentContext';
import { formatDate } from '../lib/dates';

export function BlogPage() {
  const { posts } = useSiteContent();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const categories = useMemo(() => ['All', ...Array.from(new Set(posts.map((p) => p.category))).sort()], [posts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter(
      (p) =>
        (category === 'All' || p.category === category) &&
        (!q || `${p.title} ${p.excerpt} ${p.tags.join(' ')}`.toLowerCase().includes(q)),
    );
  }, [posts, query, category]);

  return (
    <>
      <PageHero
        eyebrow="BLOG"
        title="Real stories. Practical insights. A growing community."
        lead="Devotionals, testimonies and updates from campus life."
      />
      <Section labelledBy="blog-list">
        <h2 id="blog-list" className="sr-only">
          Articles
        </h2>
        <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="blog-search" className="text-sm font-bold text-ink">
              Search articles
            </label>
            <input
              id="blog-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, topic or tag"
              className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
        </div>
        <div role="group" aria-label="Category" className="mb-8 flex flex-wrap gap-2">
          {categories.map((c) => (
            <Chip key={c} label={c} pressed={category === c} onPress={() => setCategory(c)} />
          ))}
        </div>
        {filtered.length === 0 ? (
          <EmptyState>No articles match these filters.</EmptyState>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

export function BlogPostPage() {
  const { slug = '' } = useParams();
  const { posts } = useSiteContent();
  const post = posts.find((p) => p.slug === slug);

  if (!post) {
    return (
      <Section>
        <h1 className="font-display text-3xl font-bold text-ink">Article not found</h1>
        <Link to="/blog" className="mt-6 inline-block font-bold text-ink hover:text-brand">
          ← Blog
        </Link>
      </Section>
    );
  }

  const related = posts
    .filter((p) => p.slug !== post.slug)
    .sort((a, b) => Number(b.category === post.category) - Number(a.category === post.category))
    .slice(0, 2);

  return (
    <>
      <header className="border-b border-paper-edge bg-white px-5 pb-10 pt-10 md:px-8 md:pt-14">
        <div className="mx-auto max-w-prose">
          <Link to="/blog" className="text-sm font-bold text-ink hover:text-brand">
            ← Blog
          </Link>
          <p className="mt-6 font-mono text-xs uppercase tracking-[0.12em] text-brand">{post.category}{' '}<SampleTag /></p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight text-ink md:text-5xl">{post.title}</h1>
          <p className="mt-4 text-sm text-ink-muted">
            {post.author} · {formatDate(post.date, { month: 'long', day: 'numeric', year: 'numeric' })} · {post.readMinutes} min
            read
          </p>
        </div>
      </header>

      <Section>
        <article className="mx-auto max-w-prose">
          <ImagePlaceholder label={`cover image for ${post.title}`} className="mb-10 aspect-[16/9] w-full rounded-2xl" />
          <div className="flex flex-col gap-5 text-lg leading-relaxed text-ink-soft">
            {post.paragraphs.map((para) => (
              <p key={para}>{para}</p>
            ))}
          </div>
          <ul aria-label="Tags" className="mt-10 flex flex-wrap gap-2">
            {post.tags.map((t) => (
              <li key={t} className="rounded-full bg-paper-edge px-3 py-1 text-sm text-ink-soft">
                #{t}
              </li>
            ))}
          </ul>
        </article>
      </Section>

      {related.length > 0 && (
        <Section labelledBy="related" tone="card">
          <SectionHeading id="related" title="Related posts" />
          <div className="grid gap-6 md:grid-cols-2">
            {related.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
