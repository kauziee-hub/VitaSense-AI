import { motion } from 'motion/react';
import { Brain, DatabaseZap, RadioTower, ShieldAlert, Utensils } from 'lucide-react';
import { AreaHealthIntelligenceMap } from '../components/AreaHealthIntelligenceMap';

const engineModules = [
  {
    title: 'Disease intelligence service',
    value: 'Mock-live',
    detail: 'Designed for local news, hospital, municipality, and public-health outbreak feeds.',
    icon: ShieldAlert,
  },
  {
    title: 'Anonymous symptom mesh',
    value: 'Private',
    detail: 'Aggregates nearby cough, fever, fatigue, throat, headache, allergy, and digestive reports.',
    icon: RadioTower,
  },
  {
    title: 'Food safety intelligence',
    value: 'Active',
    detail: 'Correlates vendor complaints, water alerts, outside-food exposure, and digestive clusters.',
    icon: Utensils,
  },
  {
    title: 'Personal-locality fusion',
    value: 'AI',
    detail: 'Combines sleep, HRV, hydration, AQI, workload, travel, stress, and outbreak pressure.',
    icon: Brain,
  },
  {
    title: 'Future data adapters',
    value: 'Ready',
    detail: 'Prepared for pollution, weather, drainage, food inspection, and disease outbreak APIs.',
    icon: DatabaseZap,
  },
];

export function AreaHealthMapScreen({ userId }: { userId: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <section>
        <p className="mb-2 text-xs font-black uppercase tracking-widest text-primary">Community intelligence</p>
        <h1 className="text-4xl font-black text-on-background">Live Locality Health Intelligence</h1>
        <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-on-surface-variant opacity-75">
          A privacy-preserving health traffic map for disease activity, symptom clusters, environmental hazards,
          food-safety signals, and personalized outbreak susceptibility.
        </p>
      </section>

      <AreaHealthIntelligenceMap userId={userId} />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {engineModules.map((card) => (
          <div key={card.title} className="rounded-[2rem] border border-outline-variant/25 bg-white p-6 shadow-xl shadow-black/5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <card.icon className="h-6 w-6" />
              </div>
              <span className="rounded-full bg-surface-container px-3 py-1 text-[10px] font-black uppercase text-on-surface-variant">
                {card.value}
              </span>
            </div>
            <h3 className="text-lg font-black text-on-surface">{card.title}</h3>
            <p className="mt-3 text-sm font-semibold leading-relaxed text-on-surface-variant opacity-75">{card.detail}</p>
          </div>
        ))}
      </section>
    </motion.div>
  );
}
