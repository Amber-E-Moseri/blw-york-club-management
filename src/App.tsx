import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { canUseApp } from './lib/auth';
import { MainLayout } from './components/layout/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { Events } from './pages/Events';
import { Members } from './pages/Members';
import { Cells } from './pages/Cells';
import { Announcements } from './pages/Announcements';
import { UserProfile } from './pages/UserProfile';
import { AdminHub } from './pages/AdminHub';
import { AdminDevotionalReport } from './pages/AdminDevotionalReport';
import { Login } from './pages/Login';
import { Outreach } from './pages/Outreach';
import { DailyAffirmations } from './pages/DailyAffirmations';
import { TestimonyLog } from './pages/TestimonyLog';
import { MeetingsHub } from './pages/MeetingsHub';
import { DevotionalViewer } from './pages/DevotionalViewer';
import { AdminDevotionalUpload } from './pages/AdminDevotionalUpload';
import { AdminTestimonies } from './pages/AdminTestimonies';
import { BookOfMonthPage } from './pages/BookOfMonth';
import { WeeklyMessages } from './pages/WeeklyMessages';
import { HabitTracker } from './pages/HabitTracker';
import { AdminRoleManagement } from './pages/AdminRoleManagement';
import { AdminContactReports } from './pages/AdminContactReports';
import { EmailPreferences } from './pages/EmailPreferences';
import { AdminZoomSettings } from './pages/AdminZoomSettings';
import { AdminDataExport } from './pages/AdminDataExport';
import { AdminEmailLog } from './pages/AdminEmailLog';
import { Growth } from './pages/Growth';
import { Communications } from './pages/Communications';
import { Tasks } from './pages/Tasks';
import { PushPermissionPrompt } from './components/feature/PushPermissionPrompt';
import { usePushNotifications } from './hooks/usePushNotifications';
import { PendingApproval } from './pages/PendingApproval';
import { AdminPendingApprovals } from './pages/AdminPendingApprovals';
import { PersonIdentityReview } from './pages/PersonIdentityReview';
import { WebsiteManagement } from './website/WebsiteManagement';
import { VerifyEmail } from './pages/VerifyEmail';
import { useTheme } from './hooks/useTheme';

function AppShell() {
  useTheme();
  const location = useLocation();
  const { user, loading, error, signIn, signUp, signOut } = useAuth();
  const { subscribe } = usePushNotifications(user?.id);
  const [showPushPrompt, setShowPushPrompt] = useState(true);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-york-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    // Verification is reached only from the sign-up flow. Refreshing it is safe: the pending email lives in sessionStorage.
    if (location.pathname === '/verify-email') return <VerifyEmail />;
    return <Login onSignIn={signIn} onSignUp={signUp} error={error} loading={loading} />;
  }

  // Allowlist: only an active account enters the Hub. Pending, rejected, inactive, or any other status is held here.
  if (!canUseApp(user)) {
    return <PendingApproval user={user} onSignOut={signOut} />;
  }

  return (
    <MainLayout user={user} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<Dashboard user={user} />} />
        <Route path="/events" element={<Events user={user} />} />
        <Route path="/members" element={<Members user={user} />} />
        <Route path="/cells" element={<Cells user={user} />} />
        <Route path="/announcements" element={<Announcements user={user} />} />
        <Route path="/devotionals" element={<DevotionalViewer user={user} />} />
        <Route path="/profile" element={<UserProfile currentUser={user} />} />
        <Route path="/email-preferences" element={<EmailPreferences user={user} />} />
        <Route path="/admin" element={<AdminHub user={user} />} />
        <Route path="/admin/devotionals" element={<AdminDevotionalUpload user={user} />} />
        <Route path="/admin/testimonies" element={<AdminTestimonies user={user} />} />
        <Route path="/admin/reports" element={<AdminDevotionalReport user={user} />} />
        <Route path="/admin/roles" element={<AdminRoleManagement user={user} />} />
        <Route path="/admin/contact-reports" element={<AdminContactReports user={user} />} />
        <Route path="/admin/zoom" element={<AdminZoomSettings user={user} />} />
        <Route path="/admin/exports" element={<AdminDataExport user={user} />} />
        <Route path="/admin/email-log" element={<AdminEmailLog user={user} />} />
        <Route path="/admin/pending" element={<AdminPendingApprovals user={user} />} />
        <Route path="/admin/identity-review" element={<PersonIdentityReview user={user} />} />
        <Route path="/admin/website/*" element={<WebsiteManagement user={user} />} />
        <Route path="/books" element={<BookOfMonthPage user={user} />} />
        <Route path="/contacts" element={<Outreach user={user} />} />
        <Route path="/affirmations" element={<DailyAffirmations user={user} />} />
        <Route path="/testimonies" element={<TestimonyLog user={user} />} />
        <Route path="/meetings" element={<MeetingsHub user={user} />} />
        <Route path="/messages" element={<WeeklyMessages user={user} />} />
        <Route path="/habits" element={<HabitTracker user={user} />} />
        <Route path="/growth" element={<Growth user={user} />} />
        <Route path="/communications" element={<Communications user={user} />} />
        <Route path="/tasks" element={<Tasks user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {showPushPrompt && (
        <PushPermissionPrompt
          onAllow={async () => { setShowPushPrompt(false); await subscribe(); }}
          onDismiss={() => setShowPushPrompt(false)}
        />
      )}
    </MainLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell />
    </BrowserRouter>
  );
}
