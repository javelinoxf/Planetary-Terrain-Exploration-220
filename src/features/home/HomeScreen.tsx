import { ArrowRight, Globe2, Layers3, Mountain } from 'lucide-react';

interface HomeScreenProps {
  onOpenAnalogMap: () => void;
  onOpenGeneralMap: () => void;
}

export function HomeScreen({ onOpenAnalogMap, onOpenGeneralMap }: HomeScreenProps) {
  return (
    <main className="flex h-screen w-screen items-center justify-center overflow-y-auto bg-[#07090E] px-5 py-10 text-slate-100">
      <div className="w-full max-w-5xl">
        <header className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
            <Layers3 className="h-6 w-6 text-cyan-300" />
          </div>
          <p className="text-xs font-mono uppercase tracking-[0.25em] text-cyan-400">
            Selene &amp; Ares Explorer
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Planetary terrain, Earth analogs
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            Choose a workspace to compare planetary sites with Earth analogs or explore
            global lunar and Martian datasets.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={onOpenAnalogMap}
            className="group min-h-64 rounded-xl border border-cyan-500/40 bg-gradient-to-br from-cyan-950/60 to-[#0A0E17] p-6 text-left transition hover:border-cyan-300/70 hover:shadow-lg hover:shadow-cyan-950/30"
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10">
                  <Mountain className="h-5 w-5 text-cyan-300" />
                </span>
                <span className="rounded border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-cyan-200">
                  Primary workspace
                </span>
              </div>
              <h2 className="mt-8 text-xl font-semibold">Analog Map</h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-300/80">
                Compare one of three Martian or two lunar sites with its configured Earth analog
                using generated elevation models.
              </p>
              <span className="mt-auto flex items-center gap-2 pt-6 text-sm font-medium text-cyan-300">
                Open analog comparison
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={onOpenGeneralMap}
            className="group min-h-64 rounded-xl border border-slate-700 bg-[#0A0E17] p-6 text-left transition hover:border-slate-500 hover:bg-[#0D121D]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/60">
              <Globe2 className="h-5 w-5 text-slate-200" />
            </span>
            <h2 className="mt-8 text-xl font-semibold">General Map</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
              Explore the global 2D map, switch to the interactive 3D globe, and enable planetary
              layers when needed.
            </p>
            <span className="mt-auto flex items-center gap-2 pt-6 text-sm font-medium text-slate-200">
              Open 2D Map
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
          </button>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-600">
          Planetary sites reuse the existing region presets. Earth analog locations are configured
          for comparison; their scientific equivalence should be independently assessed.
        </p>
      </div>
    </main>
  );
}
