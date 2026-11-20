'use client'

/** A refused or failed action: say what went wrong and offer the way back. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="max-w-xl rounded-xl border border-caution-line bg-caution-fill p-6">
      <h1 className="font-display text-[1.375rem] font-semibold text-caution">
        That didn&apos;t work
      </h1>
      <p className="mt-2 text-[0.9375rem] text-caution">
        {error.message || 'Something failed on the server.'}
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-[0.75rem] text-caution">ref {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex h-9 items-center rounded-lg border border-caution-line px-3.5 text-[0.875rem] font-medium text-caution"
      >
        Try again
      </button>
    </div>
  )
}
