import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from './MetricCard';

export function StitchGalleryModal() {
  const {
    stitchGalleryOpen,
    setStitchGalleryOpen,
    stitchScreensManifest,
    navigateTo
  } = useApp();

  const [selectedScreen, setSelectedScreen] = useState(stitchScreensManifest[0]);
  const [activeCategory, setActiveCategory] = useState('ALL');

  if (!stitchGalleryOpen) return null;

  const categories = ['ALL', 'WORK', 'PLANNING', 'ANALYTICS', 'AUTOMATION', 'COLLABORATION', 'SYSTEM', 'ADMIN'];

  const filteredScreens = activeCategory === 'ALL'
    ? stitchScreensManifest
    : stitchScreensManifest.filter(s => s.category === activeCategory);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div 
        className="fixed inset-0" 
        onClick={() => setStitchGalleryOpen(false)}
      ></div>

      <div className="relative bg-surface border border-border-focus rounded-xl shadow-modal w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden z-10 animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-card">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-white">
              <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[16px] font-semibold text-text-primary">Stitch Screen Design System</h3>
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[11px] border border-emerald-500/30">
                  17 Telas Importadas Conectadas
                </span>
              </div>
              <p className="text-[12px] text-text-secondary">
                Design System Obsidian Precision & Telas Oficiais geradas via Google Stitch MCP
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setStitchGalleryOpen(false)}
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-border bg-surface/50 overflow-x-auto">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-md text-[12px] font-medium font-mono transition-colors whitespace-nowrap ${
                activeCategory === cat
                  ? 'bg-white text-black font-semibold'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Body Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Screens Sidebar List */}
          <div className="w-80 border-r border-border overflow-y-auto p-3 flex flex-col gap-2 bg-surface-card/40">
            {filteredScreens.map(screen => (
              <button
                key={screen.id}
                onClick={() => setSelectedScreen(screen)}
                className={`w-full text-left p-2.5 rounded-lg border transition-all flex items-center gap-3 group ${
                  selectedScreen?.id === screen.id
                    ? 'bg-surface-elevated border-border-focus shadow-sm'
                    : 'bg-surface border-transparent hover:border-border hover:bg-surface-elevated/60'
                }`}
              >
                <div className="w-12 h-10 rounded bg-black/60 border border-border overflow-hidden flex-shrink-0 relative">
                  {screen.screenshotUrl ? (
                    <img src={screen.screenshotUrl} alt={screen.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-muted">
                      <span className="material-symbols-outlined text-[14px]">image</span>
                    </div>
                  )}
                </div>
                <div className="truncate min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-surface-elevated text-text-muted border border-border">
                      {screen.category}
                    </span>
                  </div>
                  <p className="text-[12px] font-medium text-text-primary truncate mt-1">{screen.title}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Screen Detail Preview Area */}
          <div className="flex-1 overflow-y-auto p-6 bg-background flex flex-col gap-4">
            {selectedScreen && (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <div>
                    <h4 className="text-[18px] font-semibold text-text-primary">{selectedScreen.title}</h4>
                    <p className="font-mono text-[11px] text-text-muted mt-0.5">{selectedScreen.screenName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const routeMap = {
                          'WORK': 'dashboard',
                          'PLANNING': 'kanban',
                          'ANALYTICS': 'reports',
                          'AUTOMATION': 'automations',
                          'COLLABORATION': 'notifications',
                          'SYSTEM': 'settings',
                          'ADMIN': 'admin-dashboard'
                        };
                        navigateTo(routeMap[selectedScreen.category] || 'dashboard');
                        setStitchGalleryOpen(false);
                      }}
                      className="px-3 py-1.5 rounded bg-white text-black hover:bg-gray-200 text-[12px] font-medium transition-colors shadow-sm inline-flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                      <span>Abrir Módulo Interativo</span>
                    </button>
                  </div>
                </div>

                {/* Screenshot Visual Preview */}
                <div className="rounded-xl border border-border bg-surface-card p-3 shadow-elevated">
                  <div className="rounded-lg overflow-hidden border border-border/80 bg-black/90">
                    <img
                      src={selectedScreen.screenshotUrl}
                      alt={selectedScreen.title}
                      className="w-full h-auto max-h-[600px] object-contain object-top"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
