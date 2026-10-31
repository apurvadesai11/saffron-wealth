"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="bg-surface rounded-xl shadow-sm border border-line-subtle p-8 max-w-md w-full text-center">
        <p className="text-4xl mb-4">:(</p>
        <h2 className="text-lg font-bold text-fg mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-fg-muted mb-6">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="bg-accent text-on-solid rounded-lg py-2 px-6 text-sm font-medium hover:bg-accent-strong transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
