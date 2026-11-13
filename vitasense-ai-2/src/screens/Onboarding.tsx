import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CheckCircle,
  FileText,
  HeartPulse,
  Loader2,
  Sparkles,
  Utensils,
  Users,
  X,
} from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { fetchSetupContext, saveSetupContext, type AppUser, type SetupContextPayload } from '../lib/api';

interface OnboardingScreenProps {
  user: AppUser;
  onComplete: () => void;
  onCancel: () => void;
}

const lifePhaseOptions = ['Student Life', 'Early Career', 'High-Pressure Work Life', 'Transition Phase', 'Family-Focused Life', 'Irregular Lifestyle'];
const socialOptions = ['Family', 'Friends/Roommates', 'Mostly Alone', 'Hostel Community', 'Coworkers/Classmates', 'Mixed'];
const structureOptions = ['Highly Structured', 'Moderately Structured', 'Unpredictable', 'Chaotic'];
const lifestyleOptions = ['Health Conscious', 'Balanced', 'Stress-Driven', 'Highly Busy', 'Physically Active', 'Mentally Exhausted', 'Irregular Lifestyle'];
const environmentOptions = ['Cold Climate', 'Warm Climate', 'Dry Climate', 'Nature/Outdoors', 'Indoor Controlled Environment', 'No Specific Preference'];
const eatingOptions = ['Disciplined', 'Emotional Eating', 'Irregular Eating', 'Convenience-Based', 'Late-Night Eating', 'Stress-Based Eating'];
const awarenessOptions = ['Very Aware', 'Aware', 'Moderate', 'Low Awareness'];
const stressOptions = ['Sleep', 'Appetite', 'Energy Levels', 'Mood', 'Focus', 'Physical Symptoms', 'Everything'];
const recoveryOptions = ['Rest', 'Talking to Someone', 'Isolation', 'Exercise', 'Entertainment', 'Sleep', 'Food', 'Nature/Travel'];
const lonelinessOptions = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
const burnoutOptions = ['Low', 'Medium', 'High', 'Critical'];
const interactionOptions = ['Daily', 'Few times a week', 'Weekly', 'Rarely', 'Almost never'];

type SetupForm = {
  lifePhase: string;
  socialEnvironment: string;
  lifeStructureType: string;
  lifestyleIdentity: string;
  preferredEnvironment: string;
  perceivedHealthTriggers: string;
  chronicConditions: string;
  recurringHealthPatterns: string;
  allergyConditions: string;
  majorMedicalHistory: string;
  personalHealthNote: string;
  eatingBehavior: string;
  unhealthyEatingTriggers: string;
  bodyAwarenessLevel: string;
  emotionalHealthImpact: string;
  emotionalTrackingEnabled: boolean;
  emotionalPressureSources: string;
  stressResponsePattern: string;
  recoveryPreference: string;
  lonelinessLevel: string;
  depressionSignals: string;
  anxietyTriggers: string;
  burnoutRisk: string;
  emotionalSupportSystem: string;
  copingMechanisms: string;
  emotionalStabilityScore: string;
  socialInteractionFrequency: string;
  selfIsolationPattern: string;
  emotionalNotes: string;
};

type ReadOnlyContext = {
  personalContextSummary: string;
  aiHealthSummary: string;
  aiBehavioralPatterns: string;
  aiRiskFactors: string;
  aiLifestyleAssessment: string;
};

const initialForm: SetupForm = {
  lifePhase: '',
  socialEnvironment: '',
  lifeStructureType: '',
  lifestyleIdentity: '',
  preferredEnvironment: '',
  perceivedHealthTriggers: '',
  chronicConditions: '',
  recurringHealthPatterns: '',
  allergyConditions: '',
  majorMedicalHistory: '',
  personalHealthNote: '',
  eatingBehavior: '',
  unhealthyEatingTriggers: '',
  bodyAwarenessLevel: '',
  emotionalHealthImpact: '',
  emotionalTrackingEnabled: true,
  emotionalPressureSources: '',
  stressResponsePattern: '',
  recoveryPreference: '',
  lonelinessLevel: '',
  depressionSignals: '',
  anxietyTriggers: '',
  burnoutRisk: '',
  emotionalSupportSystem: '',
  copingMechanisms: '',
  emotionalStabilityScore: '',
  socialInteractionFrequency: '',
  selfIsolationPattern: '',
  emotionalNotes: '',
};

const initialReadOnly: ReadOnlyContext = {
  personalContextSummary: '',
  aiHealthSummary: '',
  aiBehavioralPatterns: '',
  aiRiskFactors: '',
  aiLifestyleAssessment: '',
};

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function boolFromSelect(value: string): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function listToText(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'string') return value;
  return '';
}

function textValue(row: Record<string, unknown> | undefined, key: string): string {
  const value = row?.[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function boolSelectValue(value: unknown): string {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '';
}

function boolValue(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function scoreValue(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

function readonlyValue(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join('\n');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value, null, 2);
  if (typeof value === 'string') return value;
  return '';
}

function buildPayload(form: SetupForm): SetupContextPayload {
  const score = Number(form.emotionalStabilityScore);

  return {
    life_phase: nullableText(form.lifePhase),
    social_environment: nullableText(form.socialEnvironment),
    life_structure_type: nullableText(form.lifeStructureType),
    lifestyle_identity: nullableText(form.lifestyleIdentity),
    preferred_environment: nullableText(form.preferredEnvironment),
    perceived_health_triggers: splitList(form.perceivedHealthTriggers),
    chronic_conditions: splitList(form.chronicConditions),
    recurring_health_patterns: splitList(form.recurringHealthPatterns),
    allergy_conditions: splitList(form.allergyConditions),
    major_medical_history: splitList(form.majorMedicalHistory),
    personal_health_note: nullableText(form.personalHealthNote),
    eating_behavior: nullableText(form.eatingBehavior),
    unhealthy_eating_triggers: splitList(form.unhealthyEatingTriggers),
    body_awareness_level: nullableText(form.bodyAwarenessLevel),
    emotional_health_impact: boolFromSelect(form.emotionalHealthImpact),
    emotional_tracking_enabled: form.emotionalTrackingEnabled,
    emotional_pressure_sources: splitList(form.emotionalPressureSources),
    stress_response_pattern: nullableText(form.stressResponsePattern),
    recovery_preference: nullableText(form.recoveryPreference),
    loneliness_level: nullableText(form.lonelinessLevel),
    depression_signals: splitList(form.depressionSignals),
    anxiety_triggers: splitList(form.anxietyTriggers),
    burnout_risk: nullableText(form.burnoutRisk),
    emotional_support_system: nullableText(form.emotionalSupportSystem),
    coping_mechanisms: splitList(form.copingMechanisms),
    emotional_stability_score: Number.isFinite(score) ? score : null,
    social_interaction_frequency: nullableText(form.socialInteractionFrequency),
    self_isolation_pattern: nullableText(form.selfIsolationPattern),
    emotional_notes: nullableText(form.emotionalNotes),
  };
}

function formFromTables(tables: Record<string, Record<string, unknown>>): SetupForm {
  const life = tables.user_life_context;
  const medical = tables.user_medical_identity;
  const food = tables.user_food_body_relationship;
  const emotional = tables.user_emotional_wellness;

  return {
    lifePhase: textValue(life, 'life_phase'),
    socialEnvironment: textValue(life, 'social_environment'),
    lifeStructureType: textValue(life, 'life_structure_type'),
    lifestyleIdentity: textValue(life, 'lifestyle_identity'),
    preferredEnvironment: textValue(life, 'preferred_environment'),
    perceivedHealthTriggers: listToText(life?.perceived_health_triggers),
    chronicConditions: listToText(medical?.chronic_conditions),
    recurringHealthPatterns: listToText(medical?.recurring_health_patterns),
    allergyConditions: listToText(medical?.allergy_conditions),
    majorMedicalHistory: listToText(medical?.major_medical_history),
    personalHealthNote: textValue(medical, 'personal_health_note'),
    eatingBehavior: textValue(food, 'eating_behavior'),
    unhealthyEatingTriggers: listToText(food?.unhealthy_eating_triggers),
    bodyAwarenessLevel: textValue(food, 'body_awareness_level'),
    emotionalHealthImpact: boolSelectValue(food?.emotional_health_impact),
    emotionalTrackingEnabled: boolValue(emotional?.emotional_tracking_enabled, true),
    emotionalPressureSources: listToText(emotional?.emotional_pressure_sources),
    stressResponsePattern: textValue(emotional, 'stress_response_pattern'),
    recoveryPreference: textValue(emotional, 'recovery_preference'),
    lonelinessLevel: textValue(emotional, 'loneliness_level'),
    depressionSignals: listToText(emotional?.depression_signals),
    anxietyTriggers: listToText(emotional?.anxiety_triggers),
    burnoutRisk: textValue(emotional, 'burnout_risk'),
    emotionalSupportSystem: textValue(emotional, 'emotional_support_system'),
    copingMechanisms: listToText(emotional?.coping_mechanisms),
    emotionalStabilityScore: scoreValue(emotional?.emotional_stability_score),
    socialInteractionFrequency: textValue(emotional, 'social_interaction_frequency'),
    selfIsolationPattern: textValue(emotional, 'self_isolation_pattern'),
    emotionalNotes: textValue(emotional, 'emotional_notes'),
  };
}

function readOnlyFromTables(tables: Record<string, Record<string, unknown>>): ReadOnlyContext {
  const personal = tables.user_personal_context;
  const ai = tables.ai_user_health_profile;

  return {
    personalContextSummary: readonlyValue(personal?.personal_context_summary),
    aiHealthSummary: readonlyValue(ai?.ai_health_summary),
    aiBehavioralPatterns: readonlyValue(ai?.ai_behavioral_patterns),
    aiRiskFactors: readonlyValue(ai?.ai_risk_factors),
    aiLifestyleAssessment: readonlyValue(ai?.ai_lifestyle_assessment),
  };
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="space-y-2">
      <span className="ml-1 text-xs font-bold text-on-surface-variant opacity-60">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-outline-variant/20 bg-surface-container p-4 font-medium outline-none transition-all duration-200 hover:border-primary/25 focus:border-primary focus:ring-4 focus:ring-primary/10"
      >
        <option value="">Use demo baseline</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="space-y-2">
      <span className="ml-1 text-xs font-bold text-on-surface-variant opacity-60">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-24 w-full rounded-xl border border-outline-variant/20 bg-surface-container p-4 font-medium outline-none transition-all duration-200 hover:border-primary/25 focus:border-primary focus:ring-4 focus:ring-primary/10"
        placeholder={placeholder}
      />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-2">
      <span className="ml-1 text-xs font-bold text-on-surface-variant opacity-60">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-outline-variant/20 bg-surface-container p-4 font-medium outline-none transition-all duration-200 hover:border-primary/25 focus:border-primary focus:ring-4 focus:ring-primary/10"
        placeholder="0-100"
      />
    </label>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: ElementType; children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="premium-panel rounded-3xl p-8 md:p-10"
    >
      <div className="mb-8 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary-container text-on-secondary-container">
          <Icon className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-bold text-on-surface">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">{children}</div>
    </motion.section>
  );
}

function ReadOnlyPanel({ context }: { context: ReadOnlyContext }) {
  const items = [
    { label: 'Personal context summary', value: context.personalContextSummary },
    { label: 'AI health summary', value: context.aiHealthSummary },
    { label: 'AI behavioral patterns', value: context.aiBehavioralPatterns },
    { label: 'AI risk factors', value: context.aiRiskFactors },
    { label: 'AI lifestyle assessment', value: context.aiLifestyleAssessment },
  ];

  return (
    <Section title="AI Context Fields" icon={Sparkles}>
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-outline-variant/20 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-widest text-on-surface-variant/45">{item.label}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-on-surface-variant">
            {item.value || 'Demo intelligence baseline ready after sync.'}
          </p>
        </div>
      ))}
    </Section>
  );
}

export function OnboardingScreen({ user, onComplete, onCancel }: OnboardingScreenProps) {
  const [form, setForm] = useState<SetupForm>(initialForm);
  const [readOnlyContext, setReadOnlyContext] = useState<ReadOnlyContext>(initialReadOnly);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'load-error'>('idle');

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setStatus('idle');

    fetchSetupContext(user.id, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setForm(formFromTables(response.tables));
        setReadOnlyContext(readOnlyFromTables(response.tables));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setForm(initialForm);
          setReadOnlyContext(initialReadOnly);
          setStatus('load-error');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [user.id]);

  const update = (field: keyof SetupForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
    setStatus('idle');
  };

  const handleComplete = async () => {
    setIsSaving(true);
    setStatus('idle');
    try {
      await saveSetupContext(user.id, buildPayload(form));
      setStatus('saved');
      onComplete();
    } catch {
      setStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fbf9f8_0%,#f4faf7_52%,#fbf9f8_100%)]">
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-outline-variant/20 bg-surface/85 shadow-sm shadow-black/[0.03] backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-6">
          <span className="text-xl font-black text-primary">VitaSense AI</span>
          <button onClick={onCancel} className="flex items-center gap-2 rounded-full px-3 py-2 text-on-surface-variant transition-all duration-200 hover:bg-primary/5 hover:text-primary active:scale-[0.98]">
            <X className="h-5 w-5" />
            <span className="hidden text-xs font-bold md:inline">Exit setup</span>
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-[960px] px-6 pb-32 pt-24">
        <header className="mb-12 text-center md:text-left">
          <p className="mb-3 text-xs font-black uppercase text-primary">Permanent setup context</p>
          <h1 className="mb-3 text-5xl font-black text-primary">Setup context for {user.name}</h1>
          <p className="text-lg font-medium text-on-surface-variant opacity-70">
            These answers become this user's long-term wellness baseline and stay editable.
          </p>
          {status === 'load-error' && (
            <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              Existing setup rows could not be loaded. You can still save a fresh setup for this user.
            </p>
          )}
        </header>

        {isLoading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-3xl bg-white shadow-xl shadow-black/5">
            <div className="flex items-center gap-3 text-sm font-black uppercase tracking-widest text-primary">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading saved setup
            </div>
          </div>
        ) : (
          <form className="space-y-10">
            <Section title="Life Context" icon={Users}>
              <SelectField label="What stage of life are you currently in?" value={form.lifePhase} options={lifePhaseOptions} onChange={(value) => update('lifePhase', value)} />
              <SelectField label="What best describes your social environment?" value={form.socialEnvironment} options={socialOptions} onChange={(value) => update('socialEnvironment', value)} />
              <SelectField label="How structured is your daily routine?" value={form.lifeStructureType} options={structureOptions} onChange={(value) => update('lifeStructureType', value)} />
              <SelectField label="Which lifestyle best describes you?" value={form.lifestyleIdentity} options={lifestyleOptions} onChange={(value) => update('lifestyleIdentity', value)} />
              <SelectField label="What type of environment do you spend most time in?" value={form.preferredEnvironment} options={environmentOptions} onChange={(value) => update('preferredEnvironment', value)} />
              <TextAreaField label="What factors usually affect your health negatively?" value={form.perceivedHealthTriggers} onChange={(value) => update('perceivedHealthTriggers', value)} placeholder="Comma separated: low sleep, travel, AQI, workload" />
            </Section>

            <Section title="Medical Identity" icon={HeartPulse}>
              <TextAreaField label="Do you have any chronic conditions?" value={form.chronicConditions} onChange={(value) => update('chronicConditions', value)} placeholder="Comma separated, or leave blank" />
              <TextAreaField label="Do you notice recurring health patterns?" value={form.recurringHealthPatterns} onChange={(value) => update('recurringHealthPatterns', value)} placeholder="Fatigue after low sleep, throat irritation during AQI spikes" />
              <TextAreaField label="Do you have allergies?" value={form.allergyConditions} onChange={(value) => update('allergyConditions', value)} placeholder="Pollen, dust, foods, medicines" />
              <TextAreaField label="Any major medical history?" value={form.majorMedicalHistory} onChange={(value) => update('majorMedicalHistory', value)} placeholder="Surgeries, hospitalizations, major diagnoses" />
              <TextAreaField label="Anything important about your health you want the AI to know?" value={form.personalHealthNote} onChange={(value) => update('personalHealthNote', value)} placeholder="Free-form clinical context" />
            </Section>

            <Section title="Food & Body Relationship" icon={Utensils}>
              <SelectField label="What best describes your eating behavior?" value={form.eatingBehavior} options={eatingOptions} onChange={(value) => update('eatingBehavior', value)} />
              <TextAreaField label="What usually triggers unhealthy eating?" value={form.unhealthyEatingTriggers} onChange={(value) => update('unhealthyEatingTriggers', value)} placeholder="Comma separated: stress, late work, travel" />
              <SelectField label="How aware are you of your body signals?" value={form.bodyAwarenessLevel} options={awarenessOptions} onChange={(value) => update('bodyAwarenessLevel', value)} />
              <SelectField label="Does emotional state affect your physical health?" value={form.emotionalHealthImpact} options={['yes', 'no']} onChange={(value) => update('emotionalHealthImpact', value)} />
            </Section>

            <Section title="Emotional Wellness" icon={Brain}>
              <label className="flex items-center justify-between rounded-2xl bg-surface-container p-4">
                <span className="text-sm font-bold text-on-surface">Do you want emotional wellness tracking enabled?</span>
                <input type="checkbox" checked={form.emotionalTrackingEnabled} onChange={(event) => update('emotionalTrackingEnabled', event.target.checked)} className="h-5 w-5 accent-primary" />
              </label>
              <TextAreaField label="What causes emotional pressure for you?" value={form.emotionalPressureSources} onChange={(value) => update('emotionalPressureSources', value)} placeholder="Comma separated: workload, family pressure, uncertainty" />
              <SelectField label="How do you usually respond to stress?" value={form.stressResponsePattern} options={stressOptions} onChange={(value) => update('stressResponsePattern', value)} />
              <SelectField label="What helps you recover mentally?" value={form.recoveryPreference} options={recoveryOptions} onChange={(value) => update('recoveryPreference', value)} />
              <SelectField label="Loneliness level" value={form.lonelinessLevel} options={lonelinessOptions} onChange={(value) => update('lonelinessLevel', value)} />
              <TextAreaField label="Depression signals" value={form.depressionSignals} onChange={(value) => update('depressionSignals', value)} placeholder="Comma separated: low motivation, hopelessness, low energy" />
              <TextAreaField label="Anxiety triggers" value={form.anxietyTriggers} onChange={(value) => update('anxietyTriggers', value)} placeholder="Comma separated: exams, deadlines, conflict" />
              <SelectField label="Burnout risk" value={form.burnoutRisk} options={burnoutOptions} onChange={(value) => update('burnoutRisk', value)} />
              <TextAreaField label="Emotional support system" value={form.emotionalSupportSystem} onChange={(value) => update('emotionalSupportSystem', value)} placeholder="People or systems this user relies on" />
              <TextAreaField label="Coping mechanisms" value={form.copingMechanisms} onChange={(value) => update('copingMechanisms', value)} placeholder="Comma separated: walks, music, journaling, talking" />
              <NumberField label="Emotional stability score" value={form.emotionalStabilityScore} onChange={(value) => update('emotionalStabilityScore', value)} />
              <SelectField label="Social interaction frequency" value={form.socialInteractionFrequency} options={interactionOptions} onChange={(value) => update('socialInteractionFrequency', value)} />
              <TextAreaField label="Self-isolation pattern" value={form.selfIsolationPattern} onChange={(value) => update('selfIsolationPattern', value)} placeholder="When and how isolation tends to appear" />
              <TextAreaField label="Emotional notes" value={form.emotionalNotes} onChange={(value) => update('emotionalNotes', value)} placeholder="Any extra emotional context" />
            </Section>

            <ReadOnlyPanel context={readOnlyContext} />
          </form>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-50 bg-surface/90 px-6 py-6 backdrop-blur-md">
        <div className="mx-auto flex max-w-[960px] items-center justify-between">
          <button type="button" onClick={onCancel} className="flex items-center gap-2 font-bold text-on-surface-variant transition-colors hover:text-primary">
            <ArrowLeft className="h-5 w-5" /> Back
          </button>
          <div className="flex items-center gap-4">
            {status === 'error' && <span className="text-sm font-bold text-rose-600">Setup could not be saved</span>}
            {status === 'saved' && <CheckCircle className="h-5 w-5 text-primary" />}
            <button
              type="button"
              onClick={handleComplete}
              disabled={isSaving || isLoading}
              className="flex items-center gap-3 rounded-full bg-primary px-10 py-5 text-lg font-black text-white shadow-2xl shadow-primary/20 transition-all duration-200 hover:bg-[#08513e] hover:shadow-primary/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Save Setup'}
              <ArrowRight className="h-6 w-6" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
