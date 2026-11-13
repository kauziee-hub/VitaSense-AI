import { motion } from 'motion/react';
import {
  Activity,
  Brain,
  Clock,
  Edit2,
  FileCheck,
  HeartPulse,
  ShieldCheck,
  UserCircle,
  Users,
} from 'lucide-react';
import type { AppUser } from '../lib/api';

export function ProfileScreen({ user, onEdit }: { user: AppUser; onEdit: () => void }) {
  const isolatedSignals = [
    { label: 'Setup context', value: `Mapped to user_id ${user.id}`, icon: Users },
    { label: 'Daily logs', value: 'Loaded per selected user', icon: Clock },
    { label: 'Forecasts', value: 'Generated from isolated history', icon: Activity },
    { label: 'Chat memory', value: 'Stored by user and session', icon: Brain },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-widest text-primary/70">
            {user.user_code || `user-${user.id}`}
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-on-surface">{user.name}'s Health Profile</h1>
          <p className="text-lg font-medium text-on-surface-variant opacity-70">
            Review this user's isolated clinical, lifestyle, and AI context surface.
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-3 rounded-2xl bg-primary px-8 py-4 font-bold text-white shadow-xl shadow-primary/20 transition-all hover:opacity-90 active:scale-[0.98]"
        >
          <Edit2 className="h-5 w-5" />
          Edit Setup Context
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
        <section className="rounded-[2.5rem] border border-white bg-white p-10 shadow-xl shadow-black/5 md:col-span-8">
          <div className="mb-10 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UserCircle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-2xl font-bold">Selected User</h3>
              <p className="text-sm font-semibold text-on-surface-variant/60">Identity comes from the users table, not a demo profile.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-2xl bg-surface-container p-5">
              <span className="text-xs font-black uppercase tracking-widest text-on-surface-variant/40">Name</span>
              <p className="mt-2 text-lg font-black">{user.name}</p>
            </div>
            <div className="rounded-2xl bg-surface-container p-5">
              <span className="text-xs font-black uppercase tracking-widest text-on-surface-variant/40">User ID</span>
              <p className="mt-2 text-lg font-black">{user.id}</p>
            </div>
            <div className="rounded-2xl bg-surface-container p-5">
              <span className="text-xs font-black uppercase tracking-widest text-on-surface-variant/40">User Code</span>
              <p className="mt-2 text-lg font-black">{user.user_code || 'Not set'}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[2.5rem] border border-[#7ab9a1]/20 bg-[#7ab9a1]/10 p-10 md:col-span-4">
          <div className="mb-10 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
              <HeartPulse className="h-6 w-6" />
            </div>
            <h3 className="text-2xl font-bold">Context Status</h3>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <span className="text-sm font-bold opacity-70">Editable setup</span>
            <p className="mt-2 text-sm font-semibold leading-6 text-on-surface-variant">
              Open setup context to preload and update this user's DB-backed onboarding fields.
            </p>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[2.5rem] bg-zinc-900 p-10 text-white shadow-2xl md:col-span-12">
          <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative z-10 mb-8 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/30">
              <FileCheck className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-2xl font-bold">Isolation Checks</h3>
              <p className="text-sm font-semibold text-white/55">Every downstream screen receives the selected user id.</p>
            </div>
          </div>
          <div className="relative z-10 grid grid-cols-1 gap-4 md:grid-cols-4">
            {isolatedSignals.map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/8 p-5">
                <item.icon className="mb-4 h-5 w-5 text-[#aff0d6]" />
                <p className="text-sm font-black">{item.label}</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-white/55">{item.value}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="flex flex-col items-center gap-4 pt-12 text-center opacity-50">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container text-primary/60">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <p className="text-xs font-black uppercase tracking-widest">Server-only Supabase data vault</p>
      </footer>
    </motion.div>
  );
}
