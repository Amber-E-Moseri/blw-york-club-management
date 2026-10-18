// Full-page state for the public site when the content service is loading or unavailable. It never shows sample copy.

export function ServiceStatus({ title, message, live }: { title: string; message: string; live: 'status' | 'alert' }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-prose flex-col justify-center px-4 py-16 text-center">
      <p className="font-display text-2xl font-bold text-ink">BLW York Hub</p>
      <h1 className="mt-6 font-display text-3xl font-bold text-ink">{title}</h1>
      <p role={live} className="mt-4 text-base text-ink-soft">
        {message}
      </p>
    </main>
  );
}
