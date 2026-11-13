import { motion } from 'motion/react';
import { AlertTriangle, Loader2, UserRoundPlus, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { VitalSignsIcon, HealthSafetyIcon, ShieldCheckIcon } from '../components/Icons';
import { createUser, fetchUsers, type AppUser } from '../lib/api';

interface WelcomeScreenProps {
  onSelectUser: (user: AppUser, mode: 'new' | 'old') => void;
}

const fallbackUsers: AppUser[] = [
  { id: 1, user_code: 'kausik', name: 'Kausik' },
  { id: 2, user_code: 'rithik', name: 'Rithik' },
  { id: 3, user_code: 'abhishek', name: 'Abhishek' },
];

export function WelcomeScreen({ onSelectUser }: WelcomeScreenProps) {
  const [mode, setMode] = useState<'landing' | 'old' | 'new'>('landing');
  const [users, setUsers] = useState<AppUser[]>(fallbackUsers);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'old') return;
    const controller = new AbortController();
    setIsLoadingUsers(true);
    setError('');
    fetchUsers(controller.signal)
      .then((nextUsers) => {
        const preferred = nextUsers.filter((user) => ['kausik', 'rithik', 'abhishek'].includes(user.name.trim().toLowerCase()));
        setUsers(preferred.length ? preferred : fallbackUsers);
        if (!preferred.length) {
          setError('Expected users were not found in the database. Showing Kausik, Rithik, and Abhishek.');
        }
      })
      .catch(() => {
        setUsers(fallbackUsers);
        setError('Could not reach the user database. Showing the expected local users.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingUsers(false);
      });
    return () => controller.abort();
  }, [mode]);

  const sortedUsers = useMemo(
    () => [...users].sort((first, second) => first.name.localeCompare(second.name)),
    [users],
  );

  const handleCreate = async () => {
    const cleanName = newName.trim();
    if (!cleanName) {
      setError('Enter a name for the new user.');
      return;
    }
    setIsCreating(true);
    setError('');
    try {
      const user = await createUser(cleanName);
      onSelectUser(user, 'new');
    } catch {
      setError('Could not create the user. Check the backend connection and try again.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[linear-gradient(135deg,#f4faf7_0%,#fbf9f8_48%,#eef8fb_100%)]">
      <motion.main 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative w-full max-w-xl overflow-hidden rounded-[2.5rem] p-8 text-center shadow-2xl shadow-black/10 sm:p-12 glass-card"
      >
        <div className="mb-10 flex flex-col items-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary-container shadow-lg shadow-primary-container/20 ring-8 ring-primary-container/10">
            <VitalSignsIcon className="text-white w-12 h-12" />
          </div>
          <h1 className="text-primary font-bold text-4xl mb-2 tracking-tight">VitaSense AI</h1>
          <p className="text-on-surface-variant font-medium text-lg max-w-xs mx-auto opacity-70">
            Your personalized preventive healthcare companion
          </p>
        </div>

        <div className="mb-10 px-4">
          <div className="aspect-video w-full rounded-2xl overflow-hidden bg-surface-container-low shadow-inner">
            <img 
              alt="Healthcare Professional" 
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 hover:scale-105" 
              src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&auto=format&fit=crop&q=80"
            />
          </div>
        </div>

        {mode === 'landing' && (
          <div className="flex flex-col gap-4 sm:flex-row items-center justify-center w-full">
          <button
            onClick={() => setMode('new')}
            className="h-14 w-full rounded-full bg-primary font-bold text-white shadow-lg shadow-primary/20 transition-all duration-200 hover:bg-[#08513e] hover:shadow-xl hover:shadow-primary/25 active:scale-[0.98] sm:w-1/2"
          >
            New User
          </button>
          <button
            onClick={() => setMode('old')}
            className="h-14 w-full rounded-full border-2 border-primary-container bg-white/70 font-bold text-primary transition-all duration-200 hover:border-primary hover:bg-primary-container/15 active:scale-[0.98] sm:w-1/2"
          >
            Old User
          </button>
          </div>
        )}

        {mode === 'old' && (
          <div className="space-y-4 text-left">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-black text-primary">
                <Users className="h-4 w-4" />
                Select existing user
              </div>
              {isLoadingUsers && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>
            <div className="grid gap-3">
              {sortedUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onSelectUser(user, 'old')}
                  className="flex items-center justify-between rounded-2xl border border-outline-variant/30 bg-white/80 p-4 text-left transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99]"
                >
                  <span>
                    <span className="block text-base font-black text-on-surface">{user.name}</span>
                    <span className="mt-1 block text-xs font-bold text-on-surface-variant/55">{user.user_code ?? `user-${user.id}`}</span>
                  </span>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase text-primary">Open</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setMode('landing')} className="text-sm font-bold text-on-surface-variant hover:text-primary">
              Back
            </button>
          </div>
        )}

        {mode === 'new' && (
          <div className="space-y-4 text-left">
            <label className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-black text-primary">
                <UserRoundPlus className="h-4 w-4" />
                Create separate user
              </span>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Enter user name"
                className="h-14 w-full rounded-2xl border border-outline-variant/30 bg-white/85 px-4 text-sm font-bold outline-none transition-all duration-200 focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-white transition-all duration-200 hover:bg-[#08513e] active:scale-[0.98] disabled:opacity-60"
              >
                {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                Create user
              </button>
              <button type="button" onClick={() => setMode('landing')} className="rounded-full px-5 py-3 text-sm font-bold text-on-surface-variant hover:bg-primary/5 hover:text-primary">
                Back
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left text-xs font-bold leading-5 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-10 pt-6 border-t border-outline-variant/30">
          <p className="text-on-surface-variant font-medium text-xs opacity-60">
            Empowering your journey to peak health through intelligent insights.
          </p>
        </div>

        {/* Decorative elements */}
        <div className="absolute -bottom-10 -left-10 opacity-5 pointer-events-none">
          <HealthSafetyIcon className="text-primary w-48 h-48" />
        </div>
      </motion.main>

      <div className="absolute left-[10%] top-[15%] hidden items-center gap-3 rounded-2xl border border-primary/10 bg-white/85 p-3 shadow-xl shadow-black/5 backdrop-blur-md lg:flex">
        <VitalSignsIcon className="text-primary w-5 h-5" />
        <span className="text-primary font-bold text-xs uppercase tracking-wider">Vital Stats: Optimal</span>
      </div>
      
      <div className="absolute bottom-[20%] right-[10%] hidden items-center gap-3 rounded-2xl border border-primary/10 bg-white/85 p-3 shadow-xl shadow-black/5 backdrop-blur-md lg:flex">
        <ShieldCheckIcon className="text-secondary w-5 h-5" />
        <span className="text-secondary font-bold text-xs uppercase tracking-wider">AI Secure Analysis</span>
      </div>
    </div>
  );
}
