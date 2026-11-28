import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import { DailyConfessions } from './pages/DailyConfessions';
import { TestimonyLog } from './pages/TestimonyLog';
import { MeetingsHub } from './pages/MeetingsHub';
import { DevotionalViewer } from './pages/DevotionalViewer';
import { AdminDevotionalUpload } from './pages/AdminDevotionalUpload';
import { AdminTestimonies } from './pages/AdminTestimonies';
import { BookOfMonthPage } from './pages/BookOfMonth';
import { WeeklyMessages } from './pages/WeeklyMessages';
import { HabitTracker } from './pages/HabitTracker';
import { AdminRoleManagement } from './pages/AdminRoleManagement';
import { WebsiteManagement } from './website/WebsiteManagement';
import { AdminContactReports } from './pages/AdminContactReports';
import { EmailPreferences } from './pages/EmailPreferences';
import { AdminZoomSettings } from './pages/AdminZoomSettings';
import { AdminDataExport } from './pages/AdminDataExport';
import { AdminEmailLog } from './pages/AdminEmailLog';
import { Growth } from './pages/Growth';
import { PushPermissionPrompt } from './components/feature/PushPermissionPrompt';
import { usePushNotifications } from './hooks/usePushNotifications';
import { PendingApproval } from './pages/PendingApproval';
import { AdminPendingApprovals } from './pages/AdminPendingApprovals';
import { ResetPassword } from './pages/ResetPassword';
import { useTheme } from './hooks/useTheme';
import { LeadershipProvider } from './hooks/useLeadership';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

function AppShell() {
  useTheme();
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

  // Public, and checked before the sign-in gate: a recovery session must not fall through to the main app.
  if (window.location.pathname === '/hub/reset-password') return <ResetPassword />;

  if (!user) {
    return <Login onSignIn={signIn} onSignUp={signUp} error={error} loading={loading} />;
  }

  // Allowlist: only an active account enters the Hub. Pending, rejected, inactive, or any other status is held here.
  if (!canUseApp(user)) {
    return <PendingApproval user={user} onSignOut={signOut} />;
  }

  return (
    <LeadershipProvider user={user}>
    <MainLayout user={user} onSignOut={signOut}>
      <Routes>
        <Route path="/hub" element={<Dashboard user={user} />} />
        <Route path="/hub/events" element={<Events user={user} />} />
        <Route path="/hub/members" element={<ProtectedRoute user={user} requiresLeadership><Members user={user} /></ProtectedRoute>} />
        <Route path="/hub/cells" element={<ProtectedRoute user={user} requiresLeadership><Cells user={user} /></ProtectedRoute>} />
        <Route path="/hub/announcements" element={<Announcements user={user} />} />
        <Route path="/hub/devotionals" element={<DevotionalViewer user={user} />} />
        <Route path="/hub/profile" element={<UserProfile currentUser={user} />} />
        <Route path="/hub/email-preferences" element={<EmailPreferences user={user} />} />
        <Route path="/admin" element={<AdminHub user={user} />} />
        <Route path="/admin/devotionals" element={<AdminDevotionalUpload user={user} />} />
        <Route path="/admin/testimonies" element={<AdminTestimonies user={user} />} />
        <Route path="/admin/reports" element={<AdminDevotionalReport user={user} />} />
        <Route path="/admin/roles" element={<AdminRoleManagement user={user} />} />
        <Route path="/admin/website/*" element={<WebsiteManagement user={user} />} />
        <Route path="/admin/contact-reports" element={<AdminContactReports user={user} />} />
        <Route path="/admin/zoom" element={<AdminZoomSettings user={user} />} />
        <Route path="/admin/exports" element={<AdminDataExport user={user} />} />
        <Route path="/admin/email-log" element={<AdminEmailLog user={user} />} />
        <Route path="/admin/pending" element={<AdminPendingApprovals user={user} />} />
        <Route path="/hub/books" element={<BookOfMonthPage user={user} />} />
        <Route path="/hub/contacts" element={<ProtectedRoute user={user} requiresLeadership><Outreach user={user} /></ProtectedRoute>} />
        <Route path="/hub/confessions" element={<DailyConfessions user={user} />} />
        <Route path="/hub/testimonies" element={<TestimonyLog user={user} />} />
        <Route path="/hub/meetings" element={<MeetingsHub user={user} />} />
        <Route path="/hub/messages" element={<WeeklyMessages user={user} />} />
        <Route path="/hub/habits" element={<HabitTracker user={user} />} />
        <Route path="/hub/growth" element={<Growth user={user} />} />
        <Route path="*" element={<Navigate to="/hub" replace />} />
      </Routes>

      {showPushPrompt && (
        <PushPermissionPrompt
          onAllow={async () => { setShowPushPrompt(false); await subscribe(); }}
          onDismiss={() => setShowPushPrompt(false)}
        />
      )}
    </MainLayout>
    </LeadershipProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell />
    </BrowserRouter>
  );
}
