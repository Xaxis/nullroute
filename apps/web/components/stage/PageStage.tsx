import type { ReactNode } from 'react'

/**
 * The dark opening every top-level page shares with the home page: the title
 * and its lead on the left, and on the right a scene drawn from the page's
 * own data. One frame for every page, so moving between them feels like
 * turning the same object rather than opening a different site.
 */
export function PageStage({
  title,
  children,
  scene,
}: {
  title: ReactNode
  children?: ReactNode
  scene?: ReactNode
}) {
  return (
    <section className="stage stage--page on-plate">
      <div
        className={`relative mx-auto grid max-w-7xl gap-6 px-4 pt-14 pb-14 sm:px-6 sm:pt-20 sm:pb-16 lg:items-center ${
          scene === undefined ? '' : 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-10'
        }`}
      >
        <div className="arrive relative z-10 min-w-0">
          <h1 className="max-w-[22ch] font-display text-[2.5rem] leading-[1.04] tracking-[-0.025em] text-ink sm:text-[3.5rem]">
            {title}
          </h1>
          {children}
        </div>
        {scene === undefined ? null : <div className="min-w-0">{scene}</div>}
      </div>
    </section>
  )
}
