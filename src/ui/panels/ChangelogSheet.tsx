import React, { useState } from 'react';
import { Search, Sparkles, Shield, Cpu, Compass, Layers, CheckCircle } from 'lucide-react';
import { KUKUS_CHANGELOG_100, ChangelogItem } from '../../data/changelog.data';
import { SheetContainer } from './SheetContainer';
import type { GameSnapshot } from '../bridge/GameController';

type CategoryFilter = 'all' | 'economy' | 'citizens' | 'buildings' | 'terraforming' | 'ui_qol';

const CATEGORY_NAMES: Record<CategoryFilter, { label: string; icon: React.ReactNode }> = {
  all: { label: 'All 100+ Updates', icon: <Sparkles className="w-3.5 h-3.5" /> },
  economy: { label: 'Economy & Trade', icon: <Shield className="w-3.5 h-3.5" /> },
  citizens: { label: 'Citizens & Society', icon: <Compass className="w-3.5 h-3.5" /> },
  buildings: { label: 'Buildings & Infra', icon: <Layers className="w-3.5 h-3.5" /> },
  terraforming: { label: 'Terraforming', icon: <Cpu className="w-3.5 h-3.5" /> },
  ui_qol: { label: 'UI & Settings', icon: <CheckCircle className="w-3.5 h-3.5" /> },
};

export const ChangelogSheet: React.FC<{ snap: GameSnapshot }> = () => {
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = KUKUS_CHANGELOG_100.filter((item) => {
    if (filter !== 'all' && item.category !== filter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
  });

  return (
    <SheetContainer
      title="In-Game Changelog & Encyclopedia"
      subtitle="Complete catalog of 100+ features, mechanics, and visual improvements"
    >
      <div className="space-y-3">
        {/* Search & Filter */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500/70" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search 100+ updates and features..."
            className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#08160f] border border-emerald-800/60 text-stone-100 text-xs focus:border-amber-500/70 outline-none"
          />
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
          {(Object.keys(CATEGORY_NAMES) as CategoryFilter[]).map((cat) => {
            const info = CATEGORY_NAMES[cat];
            const isSelected = filter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors ${
                  isSelected
                    ? 'bg-gradient-to-b from-amber-400 to-amber-500 text-stone-950 font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]'
                    : 'bg-[#0a1d14] border border-emerald-800/55 text-stone-300 hover:text-white'
                }`}
              >
                {info.icon}
                {info.label}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-stone-400">
              No updates match your search query.
            </div>
          ) : null}

          {filtered.map((item: ChangelogItem) => (
            <div
              key={item.id}
              className="p-3.5 rounded-2xl bg-gradient-to-b from-[#132b1f]/90 to-[#0a1b12]/90 border border-emerald-700/40 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-stone-100">
                  <span className="text-amber-400 font-mono text-xs mr-2">#{item.id}</span>
                  {item.title}
                </span>
                <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  {item.category}
                </span>
              </div>
              <p className="text-xs text-stone-300 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </SheetContainer>
  );
};
