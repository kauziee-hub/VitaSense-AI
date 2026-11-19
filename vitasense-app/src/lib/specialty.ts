/** Doctor types the app can search for, and how to spot them in a chat answer. */

export const SPECIALTIES: { label: string; words: string[] }[] = [
  { label: 'Cardiologist', words: ['cardiologist', 'heart specialist'] },
  { label: 'Gastroenterologist', words: ['gastroenterologist'] },
  { label: 'Pulmonologist', words: ['pulmonologist', 'chest specialist', 'respiratory specialist'] },
  { label: 'ENT specialist', words: ['ent specialist', 'ent doctor', 'an ent', 'otolaryngologist', 'ear, nose', 'ear nose'] },
  { label: 'Dermatologist', words: ['dermatologist', 'skin specialist'] },
  { label: 'Neurologist', words: ['neurologist'] },
  { label: 'Orthopedist', words: ['orthopedic', 'orthopaedic', 'orthopedist'] },
  { label: 'Endocrinologist', words: ['endocrinologist', 'diabetologist'] },
  { label: 'Gynecologist', words: ['gynecologist', 'gynaecologist', 'obstetrician'] },
  { label: 'Psychiatrist', words: ['psychiatrist'] },
  { label: 'Psychologist', words: ['psychologist', 'therapist', 'counsellor', 'counselor'] },
  { label: 'Ophthalmologist', words: ['ophthalmologist', 'eye specialist', 'eye doctor'] },
  { label: 'Urologist', words: ['urologist'] },
  { label: 'Nephrologist', words: ['nephrologist'] },
  { label: 'Pediatrician', words: ['pediatrician', 'paediatrician'] },
  { label: 'Dentist', words: ['dentist'] },
  { label: 'Allergist', words: ['allergist', 'immunologist'] },
  { label: 'General physician', words: ['general physician', 'family doctor', 'general practitioner', 'internal medicine', 'physician'] },
];

export const QUICK_SPECIALTIES = ['General physician', 'Gastroenterologist', 'Cardiologist', 'ENT specialist', 'Dermatologist', 'Pulmonologist'];

/**
 * The doctor types an answer recommends, in the order they appear. Looks in the
 * "Which doctor" part first so a cause mentioned earlier ("the heart") isn't mistaken
 * for the recommendation.
 */
export function specialtiesIn(answer: string): string[] {
  const lower = answer.toLowerCase();
  const marker = lower.search(/which doctor|who to see|see a |consult a |consult an |visit a /);
  const scope = marker >= 0 ? lower.slice(marker) : lower;
  const found: { label: string; at: number }[] = [];
  for (const { label, words } of SPECIALTIES) {
    const at = Math.min(...words.map((w) => scope.indexOf(w)).filter((i) => i >= 0));
    if (Number.isFinite(at) && !found.some((f) => f.label === label)) found.push({ label, at });
  }
  // "physician" also matches inside other phrases; keep General physician only if nothing more specific came first.
  return found.sort((a, b) => a.at - b.at).map((f) => f.label).slice(0, 2);
}
