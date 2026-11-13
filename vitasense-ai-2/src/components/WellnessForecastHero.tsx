import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BatteryCharging,
  Brain,
  CalendarClock,
  CloudSun,
  Droplets,
  HeartPulse,
  LineChart,
  LocateFixed,
  Minus,
  Moon,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Target,
  TimerReset,
  TrendingUp,
  Utensils,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import { demoWellnessForecast, FALLBACK_USER_ID } from '../lib/demoData';
import {
  fetchWellnessForecast,
  type AlertSeverity,
  type WellnessForecast,
  type WellnessMetric,
  type WellnessTrend,
} from '../lib/api';

interface WellnessForecastHeroProps {
  userId?: number;
}

const severityStyles: Record<AlertSeverity, string> = {
  low: 'border-[#89b8c6]/35 bg-[#eef8fa] text-[#164c5b]',
  medium: 'border-[#e0a84f]/35 bg-[#fff6e6] text-[#70420d]',
  high: 'border-error/25 bg-error-container/80 text-on-error-container',
};

const darkSeverity: Record<AlertSeverity, string> = {
  low: 'border-white/10 bg-white/[0.06] text-white/72',
  medium: 'border-[#ffd48a]/20 bg-[#ffd48a]/10 text-[#ffe2ad]',
  high: 'border-[#ffb4a4]/25 bg-[#ffb4a4]/12 text-[#ffcec3]',
};

const trendCopy: Record<WellnessTrend, string> = {
  below_baseline: 'Below baseline',
  near_baseline: 'Near baseline',
  above_baseline: 'Above baseline',
  unknown: 'Learning baseline',
};

const systemIcons = {
  nervous_system: Waves,
  recovery: BatteryCharging,
  hydration: Droplets,
  emotional_resilience: HeartPulse,
  immune_stress: ShieldCheck,
  cognitive_clarity: Brain,
  sleep_pressure: Moon,
  environmental_stress: Wind,
};

function formatMetric(metric?: WellnessMetric) {
  if (!metric || metric.value === null) return 'Learning';
  const value = metric.unit === 'ml' ? Math.round(metric.value).toLocaleString() : metric.value.toLocaleString();
  return `${value}${metric.unit === 'steps' || metric.unit === 'AQI' ? '' : metric.unit}`;
}

function trendIcon(trend: WellnessTrend) {
  if (trend === 'above_baseline') return ArrowUpRight;
  if (trend === 'below_baseline') return ArrowDownRight;
  return Minus;
}

function riskIcon(type: string) {
  if (type.includes('air') || type.includes('aqi')) return Wind;
  if (type.includes('heat')) return CloudSun;
  if (type.includes('food')) return Utensils;
  return AlertTriangle;
}

function probabilityColor(probability: number) {
  if (probability >= 70) return 'bg-error';
  if (probability >= 45) return 'bg-[#d28a24]';
  return 'bg-primary';
}

export function WellnessForecastHero({ userId = FALLBACK_USER_ID }: WellnessForecastHeroProps) {
  const [forecast, setForecast] = useState<WellnessForecast>(demoWellnessForecast);
  const [status, setStatus] = useState<'loading' | 'live' | 'fallback'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');

    fetchWellnessForecast(userId, controller.signal)
      .then((nextForecast) => {
        setForecast(nextForecast);
        setStatus('live');
      })
      .catch(() => {
        setForecast(demoWellnessForecast);
        setStatus('fallback');
      });

    return () => controller.abort();
  }, [userId]);

  const topMetrics = useMemo(
    () => [
      { key: 'sleep', icon: Moon, label: 'Sleep', value: formatMetric(forecast.metrics.sleep), trend: forecast.metrics.sleep?.trend ?? 'unknown' },
      { key: 'hydration', icon: Droplets, label: 'Hydration', value: formatMetric(forecast.metrics.hydration), trend: forecast.metrics.hydration?.trend ?? 'unknown' },
      { key: 'hrv', icon: Waves, label: 'HRV', value: formatMetric(forecast.metrics.hrv), trend: forecast.metrics.hrv?.trend ?? 'unknown' },
      { key: 'aqi', icon: Wind, label: 'AQI', value: formatMetric(forecast.metrics.aqi), trend: forecast.metrics.aqi?.trend ?? 'unknown' },
    ],
    [forecast.metrics],
  );

  const hero = forecast.hero_prediction;
  const futureForecast = forecast.future_forecast ?? [];
  const bodySystems = forecast.body_systems ?? [];
  const reasoningTimeline = forecast.reasoning_timeline ?? [];
  const behavioralDetections = forecast.behavioral_detections ?? forecast.patterns.map((pattern) => ({
    ...pattern,
    confidence: 'medium',
    evidence: 'Recent daily signals',
  }));
  const strategist = forecast.health_strategist ?? forecast.suggested_actions.map((action) => ({
    ...action,
    priority: 'medium' as AlertSeverity,
    horizon: '24h',
  }));
  const liveAlerts = forecast.live_risk_intelligence?.local_alerts ?? forecast.environmental_alerts;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: 'easeOut' }}
      className="space-y-6"
    >
      <div className="relative overflow-hidden rounded-[2rem] bg-[#0f1916] text-white shadow-2xl shadow-black/15">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#94d4bb] via-[#78a7c8] to-[#ffb4a4]" />
        <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-[#94d4bb]/10 blur-3xl" />
        <div className="relative grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mb-8 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[#aff0d6]">
                <Sparkles className="h-3.5 w-3.5" />
                Longitudinal Health Intelligence
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white/65">
                {status === 'live' ? 'Live Supabase signals' : status === 'loading' ? 'Syncing 30-day history' : 'Demo intelligence'}
                {status === 'loading' && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white/65">
                <Network className="h-3.5 w-3.5" />
                {forecast.analysis_window_days ?? 30} day model
              </span>
            </div>

            <div className="max-w-4xl">
              <p className="mb-3 text-sm font-bold uppercase tracking-widest text-[#94d4bb]/80">Predictive system state</p>
              <h2 className="text-3xl font-black leading-[1.05] tracking-normal sm:text-5xl lg:text-6xl">
                {hero?.statement ?? forecast.headline}
              </h2>
              <p className="mt-6 max-w-3xl text-base font-medium leading-8 text-white/72 sm:text-lg">
                {forecast.summary}
              </p>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {topMetrics.map((metric) => {
                const TrendIcon = trendIcon(metric.trend);
                return (
                  <motion.div
                    key={metric.key}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="rounded-2xl border border-white/10 bg-white/[0.07] p-4"
                  >
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <metric.icon className="h-5 w-5 text-[#94d4bb]" />
                      <TrendIcon className="h-4 w-4 text-white/50" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-widest text-white/45">{metric.label}</p>
                    <p className="mt-1 text-2xl font-black">{metric.value}</p>
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-white/40">{trendCopy[metric.trend]}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <aside className="border-t border-white/10 bg-white/[0.04] p-6 sm:p-8 xl:border-l xl:border-t-0">
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="relative h-36 w-36">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" aria-label="Readiness score">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="12" />
                  <motion.circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke="#94d4bb"
                    strokeLinecap="round"
                    strokeWidth="12"
                    strokeDasharray="314"
                    initial={{ strokeDashoffset: 314 }}
                    animate={{ strokeDashoffset: 314 - (forecast.readiness_score / 100) * 314 }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-black">{forecast.readiness_score}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/45">Readiness</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-white/45">Engine scores</p>
                <div className="mt-4 space-y-3">
                  {(Object.entries(forecast.engine_scores ?? { recovery: forecast.recovery.score, energy: forecast.energy.score }) as Array<[string, number]>).slice(0, 5).map(([key, value]) => (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold">
                        <span className="capitalize text-white/70">{key.replace('_', ' ')}</span>
                        <span>{Math.round(value)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10">
                        <motion.div
                          className="h-full rounded-full bg-[#94d4bb]"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(4, Math.min(100, value))}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {(hero?.primary_risks ?? futureForecast.map((item) => item.title)).slice(0, 3).map((risk) => (
                <div key={risk} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                  <Target className="h-5 w-5 shrink-0 text-[#ffb4a4]" />
                  <p className="text-sm font-bold leading-5 text-white/76">{risk}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="premium-panel rounded-[2rem] p-6 sm:p-7">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-primary/75">Why this is happening</p>
              <h3 className="mt-2 text-2xl font-black text-on-background">Causal timeline</h3>
            </div>
            <LineChart className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-4">
            {reasoningTimeline.slice(0, 6).map((item, index) => (
              <motion.div
                key={`${item.title}-${index}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="grid grid-cols-[auto_1fr] gap-4"
              >
                <div className="flex flex-col items-center">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full border ${severityStyles[item.severity]}`}>
                    <TimerReset className="h-5 w-5" />
                  </div>
                  {index < reasoningTimeline.length - 1 && <div className="mt-2 h-full min-h-8 w-px bg-outline-variant/50" />}
                </div>
                <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-lowest p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-black text-on-background">{item.title}</h4>
                    <span className="rounded-full bg-primary/8 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                      {item.source_table}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium leading-6 text-on-surface-variant">{item.detail}</p>
                  <p className="mt-3 text-xs font-bold text-primary/80">{item.evidence}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="premium-panel rounded-[2rem] p-6 sm:p-7">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-primary/75">Future forecast</p>
              <h3 className="mt-2 text-2xl font-black text-on-background">Next 24 to 72 hours</h3>
            </div>
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-4">
            {futureForecast.slice(0, 5).map((item) => (
              <div key={`${item.horizon}-${item.title}`} className="rounded-2xl border border-outline-variant/35 bg-surface-container-lowest p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">{item.horizon}</span>
                    <h4 className="mt-1 text-base font-black text-on-background">{item.title}</h4>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${severityStyles[item.severity]}`}>{item.probability}%</span>
                </div>
                <div className="h-2 rounded-full bg-surface-container-high">
                  <motion.div
                    className={`h-full rounded-full ${probabilityColor(item.probability)}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${item.probability}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.signals.slice(0, 3).map((signal) => (
                    <span key={signal} className="rounded-full bg-primary/8 px-3 py-1 text-[11px] font-bold text-primary">
                      {signal}
                    </span>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 text-xs font-bold text-on-surface-variant sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    Best: {item.best_window}
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-primary" />
                    Recover: {item.recovery_window}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="premium-panel rounded-[2rem] p-6 sm:p-7">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-primary/75">Body system status</p>
            <h3 className="mt-2 text-2xl font-black text-on-background">Physiology map</h3>
          </div>
          <Stethoscope className="h-6 w-6 text-primary" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {bodySystems.slice(0, 8).map((system, index) => {
            const Icon = systemIcons[system.key as keyof typeof systemIcons] ?? Activity;
            const TrendIcon = trendIcon(system.trend);
            return (
              <motion.div
                key={system.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                className="rounded-2xl border border-outline-variant/35 bg-surface-container-lowest p-4"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <TrendIcon className="h-5 w-5 text-on-surface-variant" />
                </div>
                <p className="text-sm font-black text-on-background">{system.label}</p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <span className="text-3xl font-black text-on-background">{system.score}</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">{trendCopy[system.trend]}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-surface-container-high">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${system.score}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
                <p className="mt-3 text-xs font-semibold leading-5 text-on-surface-variant">{system.explanation}</p>
                <p className="mt-3 text-[11px] font-black uppercase tracking-widest text-primary/75">{system.monthly_comparison}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="premium-panel rounded-[2rem] p-6 sm:p-7 xl:col-span-1">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-primary/75">Behavioral detection</p>
              <h3 className="mt-2 text-2xl font-black text-on-background">Personal patterns</h3>
            </div>
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-3">
            {behavioralDetections.slice(0, 5).map((pattern) => (
              <div key={pattern.title} className="rounded-2xl border border-outline-variant/35 bg-surface-container-lowest p-4">
                <div className="flex items-start gap-3">
                  <Network className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-black text-on-background">{pattern.title}</p>
                    <p className="mt-2 text-sm font-medium leading-6 text-on-surface-variant">{pattern.detail}</p>
                    <p className="mt-3 text-[11px] font-black uppercase tracking-widest text-primary/75">
                      {pattern.confidence} confidence - {pattern.evidence}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="premium-panel rounded-[2rem] p-6 sm:p-7 xl:col-span-1">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-primary/75">AI health strategist</p>
              <h3 className="mt-2 text-2xl font-black text-on-background">Adaptive plan</h3>
            </div>
            <Target className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-3">
            {strategist.slice(0, 5).map((action) => (
              <div key={action.title} className={`rounded-2xl border p-4 ${severityStyles[action.priority]}`}>
                <div className="flex items-start gap-3">
                  <ArrowRight className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-black">{action.title}</p>
                      <span className="rounded-full bg-white/50 px-2 py-1 text-[10px] font-black uppercase tracking-widest">{action.horizon}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-6 opacity-80">{action.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[2rem] bg-[#101715] p-6 text-white shadow-2xl shadow-black/15 sm:p-7 xl:col-span-1">
          <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-[#78a7c8]/10 blur-3xl" />
          <div className="relative">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-[#94d4bb]">Live risk intelligence</p>
                <h3 className="mt-2 text-2xl font-black">Local watch layer</h3>
              </div>
              <LocateFixed className="h-6 w-6 text-[#94d4bb]" />
            </div>
            <div className="space-y-3">
              {liveAlerts.slice(0, 4).map((alert) => {
                const Icon = riskIcon(alert.type);
                return (
                  <div key={`${alert.type}-${alert.title}`} className={`rounded-2xl border p-4 ${darkSeverity[alert.severity]}`}>
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <p className="text-sm font-black">{alert.title}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 opacity-75">{alert.detail}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 space-y-2">
              {(forecast.live_risk_intelligence?.service_placeholders ?? []).slice(0, 3).map((service) => (
                <div key={service.name} className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                  <p className="text-xs font-black text-white">{service.name}</p>
                  <p className="mt-1 text-[11px] font-semibold leading-5 text-white/55">{service.purpose}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </motion.section>
  );
}
