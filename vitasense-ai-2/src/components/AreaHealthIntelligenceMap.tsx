import {
  Activity,
  AlertTriangle,
  BellRing,
  Biohazard,
  Building2,
  CloudSun,
  Crosshair,
  Droplets,
  Factory,
  Map,
  MapPin,
  RadioTower,
  Radar,
  RefreshCw,
  ShieldAlert,
  Siren,
  ThermometerSun,
  Utensils,
  Users,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { demoLocalityHealthIntelligence, FALLBACK_USER_ID } from '../lib/demoData';
import {
  fetchLocalityHealthIntelligence,
  type AlertSeverity,
  type LocalityHealthIntelligence,
  type LocalityHotspot,
  type LocalityLayerId,
} from '../lib/api';

const layerMeta: Record<LocalityLayerId, { label: string; icon: typeof Activity; tone: string; glow: string }> = {
  disease: { label: 'Disease', icon: ShieldAlert, tone: 'bg-rose-500', glow: 'shadow-rose-500/40' },
  symptoms: { label: 'Symptoms', icon: Users, tone: 'bg-sky-500', glow: 'shadow-sky-500/40' },
  hazards: { label: 'Hazards', icon: CloudSun, tone: 'bg-amber-500', glow: 'shadow-amber-500/40' },
  food: { label: 'Food Safety', icon: Utensils, tone: 'bg-fuchsia-500', glow: 'shadow-fuchsia-500/40' },
  predictive: { label: 'Predictive', icon: Radar, tone: 'bg-emerald-400', glow: 'shadow-emerald-400/40' },
};

const severityClass: Record<AlertSeverity, string> = {
  low: 'border-sky-300/35 bg-sky-50 text-sky-900',
  medium: 'border-amber-300/35 bg-amber-50 text-amber-950',
  high: 'border-rose-300/35 bg-rose-50 text-rose-950',
};

const darkSeverity: Record<AlertSeverity, string> = {
  low: 'border-sky-300/20 bg-sky-300/10 text-sky-100',
  medium: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  high: 'border-rose-300/25 bg-rose-300/10 text-rose-100',
};

const hotspotTone: Record<AlertSeverity, string> = {
  low: 'bg-sky-400 shadow-sky-400/40',
  medium: 'bg-amber-400 shadow-amber-400/40',
  high: 'bg-rose-500 shadow-rose-500/40',
};

const hotspotIcons: Partial<Record<string, typeof Activity>> = {
  'viral-fever-activity': Biohazard,
  'dengue-mosquito-watch': Droplets,
  'throat-cough-cluster': Users,
  'drainage-overflow': AlertTriangle,
  'aqi-construction-corridor': Wind,
  'foodborne-illness-zone': Utensils,
  'unsafe-water-advisory': Droplets,
  'personal-risk-fusion': Radar,
};

interface AreaHealthIntelligenceMapProps {
  compact?: boolean;
  userId?: number;
  city?: string;
  locality?: string;
  radiusKm?: number;
}

function probabilityTone(probability: number) {
  if (probability >= 70) return 'bg-rose-500';
  if (probability >= 45) return 'bg-amber-400';
  return 'bg-sky-400';
}

function signalIcon(signal: LocalityHotspot) {
  return hotspotIcons[signal.id] ?? layerMeta[signal.layer].icon;
}

export function AreaHealthIntelligenceMap({
  compact = false,
  userId = FALLBACK_USER_ID,
  city = 'Bengaluru',
  locality = 'Koramangala',
  radiusKm = 3,
}: AreaHealthIntelligenceMapProps) {
  const [activeLayer, setActiveLayer] = useState<LocalityLayerId>('disease');
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [intel, setIntel] = useState<LocalityHealthIntelligence>(demoLocalityHealthIntelligence);
  const [status, setStatus] = useState<'loading' | 'live' | 'fallback'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    fetchLocalityHealthIntelligence(userId, { city, locality, radiusKm }, controller.signal)
      .then((nextIntel) => {
        setIntel(nextIntel);
        setStatus('live');
        setSelectedHotspotId(null);
      })
      .catch(() => {
        setIntel(demoLocalityHealthIntelligence);
        setStatus('fallback');
      });

    return () => controller.abort();
  }, [city, locality, radiusKm, userId]);

  const visibleHotspots = useMemo(
    () => intel.hotspots.filter((hotspot) => hotspot.layer === activeLayer),
    [activeLayer, intel.hotspots],
  );
  const activeHotspot = useMemo(
    () => visibleHotspots.find((hotspot) => hotspot.id === selectedHotspotId) ?? visibleHotspots[0] ?? intel.hotspots[0],
    [intel.hotspots, selectedHotspotId, visibleHotspots],
  );
  const topCards = intel.risk_cards.slice(0, compact ? 3 : 6);
  const activeLayerMeta = layerMeta[activeLayer];
  const ActiveLayerIcon = activeLayerMeta.icon;

  return (
    <section className="overflow-hidden rounded-[2rem] bg-[#07110f] text-white shadow-2xl shadow-black/25">
      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="relative min-h-[520px] border-b border-white/10 p-5 sm:p-7 xl:border-b-0 xl:border-r">
          <div className="relative z-10 flex flex-col gap-5 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-[#aff0d6]">
                <Map className="h-4 w-4" />
                Live Area Health Radar
              </div>
              <h2 className={`${compact ? 'text-2xl' : 'text-4xl'} font-black tracking-tight`}>
                {intel.locality} locality intelligence
              </h2>
              <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-white/62">
                {intel.scan_status.summary}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:min-w-[360px]">
              {[
                { label: 'Overall', value: `${intel.scan_status.overall_probability}%`, icon: Siren },
                { label: 'Radius', value: `${intel.radius_km}km`, icon: Crosshair },
                { label: status === 'live' ? 'Live' : status === 'loading' ? 'Sync' : 'Demo', value: `${intel.scan_status.refreshed_minutes_ago}m`, icon: status === 'loading' ? RefreshCw : RadioTower },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
                  <item.icon className={`mb-3 h-5 w-5 text-[#94d4bb] ${status === 'loading' && item.label === 'Sync' ? 'animate-spin' : ''}`} />
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/38">{item.label}</p>
                  <p className="mt-1 text-2xl font-black">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mt-7 h-[360px] overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#10221e] sm:h-[430px]">
            <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px]" />
            <div className="absolute inset-6 rounded-[2rem] border border-[#aff0d6]/10" />
            <div className="absolute left-1/2 top-1/2 h-[82%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#aff0d6]/18" />
            <div className="absolute left-1/2 top-1/2 h-[58%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#aff0d6]/16" />
            <div className="absolute left-1/2 top-1/2 h-[34%] w-[34%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#aff0d6]/14" />
            <motion.div
              className="absolute left-1/2 top-1/2 h-[82%] w-[2px] origin-top bg-gradient-to-b from-[#aff0d6]/75 via-[#aff0d6]/10 to-transparent"
              animate={{ rotate: 360 }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
            />
            <div className="absolute left-[12%] top-[30%] h-2 w-[76%] rotate-[-8deg] rounded-full bg-white/8" />
            <div className="absolute left-[38%] top-[8%] h-[84%] w-2 rotate-[18deg] rounded-full bg-white/7" />
            <div className="absolute bottom-5 left-5 rounded-full border border-white/10 bg-black/35 px-3 py-2 text-[10px] font-black uppercase text-white/62 backdrop-blur-md">
              {intel.city} scan grid
            </div>
            <div className="absolute right-5 top-5 rounded-full border border-white/10 bg-black/35 px-3 py-2 text-[10px] font-black uppercase text-[#aff0d6] backdrop-blur-md">
              {activeLayerMeta.label} layer
            </div>

            {visibleHotspots.map((hotspot) => {
              const Icon = signalIcon(hotspot);
              const isSelected = activeHotspot?.id === hotspot.id;
              return (
                <motion.button
                  key={hotspot.id}
                  type="button"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: isSelected ? 1.12 : 1, opacity: 1 }}
                  whileHover={{ scale: 1.12 }}
                  onClick={() => setSelectedHotspotId(hotspot.id)}
                  className="absolute cursor-pointer"
                  style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
                  aria-label={hotspot.title}
                >
                  <span className={`absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full ${hotspotTone[hotspot.severity]} opacity-[0.12] blur-md`} />
                  <span className={`absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full ${hotspotTone[hotspot.severity]} opacity-25`} />
                  <span className={`relative flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full ${hotspotTone[hotspot.severity]} shadow-2xl`}>
                    <Icon className="h-5 w-5 text-white" />
                  </span>
                </motion.button>
              );
            })}

            {activeHotspot && (
              <motion.div
                key={activeHotspot.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-5 right-5 w-[min(360px,78%)] rounded-2xl border border-white/10 bg-black/62 p-4 backdrop-blur-xl"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/42">
                      {activeHotspot.affected_radius_km}km affected radius
                    </p>
                    <h3 className="mt-1 text-base font-black">{activeHotspot.title}</h3>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${darkSeverity[activeHotspot.severity]}`}>
                    {activeHotspot.risk_probability}%
                  </span>
                </div>
                <p className="text-xs font-medium leading-relaxed text-white/66">{activeHotspot.detail}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {activeHotspot.probable_symptoms.slice(0, 4).map((symptom) => (
                    <span key={symptom} className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-[10px] font-bold text-white/65">
                      {symptom}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </div>

          {!compact && (
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {intel.mock_intelligence_feeds.slice(0, 5).map((feed) => (
                <div key={feed.name} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <Building2 className="h-4 w-4 text-[#94d4bb]" />
                    <span className="rounded-full bg-[#94d4bb]/12 px-2 py-1 text-[10px] font-black uppercase text-[#aff0d6]">{feed.status}</span>
                  </div>
                  <p className="text-xs font-black text-white">{feed.name}</p>
                  <p className="mt-1 text-2xl font-black text-white/90">{feed.signals}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-5 text-on-surface sm:p-7">
          <div className="grid grid-cols-2 gap-2">
            {intel.layers.map((layer) => {
              const meta = layerMeta[layer.id];
              const Icon = meta.icon;
              const isActive = activeLayer === layer.id;
              return (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => {
                    setActiveLayer(layer.id);
                    setSelectedHotspotId(null);
                  }}
                  className={`flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all duration-200 ${
                    isActive
                      ? 'border-primary bg-primary text-white shadow-lg shadow-primary/20'
                      : 'border-outline-variant/30 bg-surface-container/60 text-on-surface-variant hover:border-primary/40 hover:bg-primary/5'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-black">{layer.label}</span>
                    <span className={`mt-1 block text-[10px] font-black uppercase ${isActive ? 'text-white/58' : 'text-on-surface-variant/50'}`}>
                      {layer.signal_count} signals - {layer.probability}%
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-[1.5rem] bg-surface-container/70 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${activeLayerMeta.tone} text-white shadow-xl ${activeLayerMeta.glow}`}>
                  <ActiveLayerIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/50">Active layer</p>
                  <p className="text-base font-black">{activeLayerMeta.label}</p>
                </div>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black text-primary">
                {visibleHotspots.length} live signals
              </span>
            </div>
            <div className="space-y-3">
              {visibleHotspots.map((hotspot) => (
                <button
                  key={hotspot.id}
                  type="button"
                  onClick={() => setSelectedHotspotId(hotspot.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 ${severityClass[hotspot.severity]}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black">{hotspot.title}</p>
                      <p className="mt-1 text-xs font-semibold leading-5 opacity-75">{hotspot.detail}</p>
                    </div>
                    <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-black uppercase">
                      {hotspot.risk_probability}%
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-white/65">
                    <motion.div
                      className={`h-full rounded-full ${probabilityTone(hotspot.risk_probability)}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${hotspot.risk_probability}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {!compact && (
            <div className="mt-6 grid grid-cols-2 gap-3">
              {[
                { label: 'Symptom reports', value: intel.community_symptom_clusters.reduce((sum, cluster) => sum + cluster.reports_48h, 0), icon: Users },
                { label: 'Top probability', value: `${Math.max(...intel.hotspots.map((spot) => spot.risk_probability))}%`, icon: BellRing },
                { label: 'AQI corridor', value: intel.hotspots.find((spot) => spot.id.includes('aqi'))?.risk_probability ?? 0, icon: Wind },
                { label: 'Hazard feeds', value: intel.mock_intelligence_feeds.length, icon: Factory },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-outline-variant/25 bg-white p-4 shadow-xl shadow-black/5">
                  <item.icon className="mb-3 h-5 w-5 text-primary" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/50">{item.label}</p>
                  <p className="mt-1 text-2xl font-black">{item.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div className="border-t border-white/10 bg-[#0b1512] p-5 sm:p-7">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <section>
              <div className="mb-4 flex items-center gap-3">
                <Waves className="h-5 w-5 text-[#94d4bb]" />
                <h3 className="text-xl font-black">Community symptom mapping</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {intel.community_symptom_clusters.map((cluster) => (
                  <div key={cluster.id} className={`rounded-2xl border p-4 ${darkSeverity[cluster.severity]}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black capitalize">{cluster.symptom}</p>
                        <p className="mt-1 text-xs font-semibold opacity-70">{cluster.zone} - {cluster.radius_km}km radius</p>
                      </div>
                      <span className="text-2xl font-black">{cluster.reports_48h}</span>
                    </div>
                    <p className="mt-3 text-[11px] font-black uppercase tracking-widest opacity-65">
                      {cluster.weekly_change_percent}% weekly rise
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-4 flex items-center gap-3">
                <Zap className="h-5 w-5 text-[#94d4bb]" />
                <h3 className="text-xl font-black">Risk card system</h3>
              </div>
              <div className="grid gap-3">
                {topCards.map((card) => (
                  <div key={card.title} className={`rounded-2xl border p-4 ${darkSeverity[card.risk_level]}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-base font-black">{card.title}</p>
                        <p className="mt-2 text-sm font-semibold leading-6 opacity-75">{card.why_this_is_happening}</p>
                      </div>
                      <div className="shrink-0 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-center">
                        <p className="text-[10px] font-black uppercase tracking-widest opacity-55">Future</p>
                        <p className="text-2xl font-black">{card.future_probability}%</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {card.probable_symptoms.slice(0, 5).map((symptom) => (
                        <span key={symptom} className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-[10px] font-bold opacity-80">
                          {symptom}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-xs font-bold leading-5 opacity-75">{card.suggested_precautions[0]}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.05] p-5">
            <div className="mb-4 flex items-center gap-3">
              <MapPin className="h-5 w-5 text-[#94d4bb]" />
              <h3 className="text-xl font-black">AI correlation engine</h3>
            </div>
            <p className="max-w-5xl text-sm font-medium leading-7 text-white/68">{intel.correlation_explanation}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {intel.predictive_lifestyle_risks.slice(0, 3).map((risk) => (
                <div key={risk.title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-black">{risk.title}</p>
                    <span className="rounded-full bg-[#94d4bb]/12 px-2.5 py-1 text-[10px] font-black uppercase text-[#aff0d6]">{risk.horizon}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10">
                    <motion.div
                      className={`h-full rounded-full ${probabilityTone(risk.probability)}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${risk.probability}%` }}
                      transition={{ duration: 0.7 }}
                    />
                  </div>
                  <p className="mt-3 text-xs font-semibold leading-5 text-white/62">{risk.personalized_message}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
