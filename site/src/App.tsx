import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { SiteLayout } from './components/SiteLayout';
import { SiteContentProvider } from './content/SiteContentContext';
import type { SiteContent } from './content/types';
import { AboutPage } from './pages/AboutPage';
import { BlogPage, BlogPostPage } from './pages/BlogPages';
import { EventDetailPage, EventsPage } from './pages/EventsPages';
import { FoundationSchoolPage } from './pages/FoundationSchoolPage';
import { HomePage } from './pages/HomePage';
import { ContactPage, NewHerePage, NotFoundPage } from './pages/FormPages';
import { RhapsodyPage, RhapsodyReaderPage } from './pages/RhapsodyPages';

interface AppProps {
  /** Optional content override, used by tests and by the future CMS loader. Defaults to the sample content. */
  content?: SiteContent;
}

export default function App({ content }: AppProps) {
  return (
    <SiteContentProvider content={content}>
      <ScrollToTopOnNavigate />
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:slug" element={<EventDetailPage />} />
          <Route path="rhapsody" element={<RhapsodyPage />} />
          <Route path="rhapsody/:slug" element={<RhapsodyReaderPage />} />
          <Route path="foundation-school" element={<FoundationSchoolPage />} />
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<BlogPostPage />} />
          <Route path="new-here" element={<NewHerePage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </SiteContentProvider>
  );
}

function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);
  return null;
}
