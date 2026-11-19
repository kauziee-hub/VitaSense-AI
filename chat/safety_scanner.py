"""Medical safety checks around the chat model.

Three tiers for what the user writes:
- BLOCK: unmistakable emergencies (or self-harm) get a fixed message and never reach the model.
- FLAG with triage_flags: symptoms that *can* be serious but usually are not (chest pain,
  breathlessness, severe headache...). The model answers, but must open with the danger
  signs and then walk through the possible causes. "Chest pain" alone is far more often
  reflux or a strained muscle than a heart attack, and the product exists to say so.
- PASS: everything else.

The model's reply is never blocked for *mentioning* an emergency condition (it has to, to
explain a differential). It is flagged when it diagnoses or names a medicine/dose.
"""

import re
from dataclasses import dataclass, field
from enum import Enum


class SafetyResult(Enum):
    PASS = "pass"
    FLAG = "flag"
    BLOCK = "block"


ESCALATION_MESSAGE = (
    "⚠️ The symptoms you're describing may require immediate medical attention. "
    "Please call emergency services (112 / 911) or go to your nearest emergency room immediately. "
    "Do not wait or self-medicate."
)

CRISIS_MESSAGE = (
    "💛 I'm really glad you told me. You don't have to go through this alone. "
    "Please talk to someone right now: call Tele-MANAS on 14416 (free, 24/7, India) "
    "or emergency services on 112. If you're outside India, call your local emergency number. "
    "If you can, reach out to someone you trust and stay with them."
)

DISCLAIMER = (
    "⚕️ This is not medical advice. If symptoms worsen or you have any concerns, "
    "please consult a qualified healthcare professional."
)

NO_PRESCRIPTION_NOTE = (
    "💊 VitaSense never recommends medicines or doses. Please ask a doctor or pharmacist "
    "before taking anything."
)

# Always an emergency, whatever else is going on.
EMERGENCY_PATTERNS: tuple[str, ...] = (
    r"\bcan'?t breathe\b",
    r"\bcannot breathe\b",
    r"\bstruggling to breathe\b",
    r"\bgasping for (air|breath)\b",
    r"\bblood in (vomit|stool|urine|poop)\b",
    r"\bbloody (vomit|stool|urine)\b",
    r"\b(vomiting|coughing) (up )?blood\b",
    r"\bworst headache\b",
    r"\bthunderclap headache\b",
    r"\bloss of consciousness\b",
    r"\bpassed out\b",
    r"\bfaint(ed|ing)\b",
    r"\bunconscious\b",
    r"\bfacial droop\b",
    r"\bface (is )?drooping\b",
    r"\barm weakness\b",
    r"\bspeech (difficulty|slurred)\b",
    r"\bslurred speech\b",
    r"\bthroat (is )?(swelling|closing)\b",
    r"\banaphylaxis\b",
    r"\boverdose\b",
    r"(?<!food )\bpoison(ing|ed)\b",
    r"\bseizures?\b",
    r"\bconvulsions?\b",
    r"\b(having|had|is having) (a )?(heart attack|stroke)\b",
    r"\bi\s*(am|'m) dying\b",
)

SELF_HARM_PATTERNS: tuple[str, ...] = (
    r"\bsuicid\w*\b",
    r"\bself.?harm\w*\b",
    r"\bkill (myself|me)\b",
    r"\bend (it all|my life)\b",
    r"\bwant to die\b",
)

CHEST_SYMPTOM = r"\bchest (pain|pressure|tightness|heaviness)\b|\bpain in (my|the) chest\b"
# Chest symptom plus any of these is treated as a possible heart attack.
CHEST_RED_FLAGS: tuple[str, ...] = (
    r"\bsweat(ing|y)?\b",
    r"\b(left )?arm\b",
    r"\bjaw\b",
    r"\bradiat\w*\b",
    r"\bspread\w*\b",
    r"\bshort(ness)? of breath\b",
    r"\bbreathless\w*\b",
    r"\bdifficulty breathing\b",
    r"\bcrushing\b",
    r"\bsqueez\w*\b",
)

# Symptoms the model must triage carefully (danger signs first), not refuse.
TRIAGE_PATTERNS: dict[str, str] = {
    "chest symptom": CHEST_SYMPTOM,
    "breathing difficulty": r"\bshort(ness)? of breath\b|\bdifficulty breathing\b|\bbreathless\w*\b",
    "severe headache": r"\bsevere headache\b",
    "high fever": r"\bhigh fever\b|\bfever (of|above|over) 10[2-9]\b|\bfever (of|above|over) (39|40|41)\b",
    "palpitations": r"\bpalpitations?\b|\bheart (is )?racing\b",
    "abdominal pain": r"\b(severe )?(stomach|abdominal|belly) pain\b",
    "dizziness": r"\bdizz(y|iness)\b",
    "heart or stroke worry": r"\bheart attack\b|\bstroke\b",
}

DIAGNOSIS_PATTERNS: tuple[str, ...] = (
    r"\byou have [a-z ]+\b",
    r"\bthis is definitely\b",
    r"\byou are (suffering from|diagnosed with)\b",
    r"\bi diagnose\b",
    r"\bmy diagnosis is\b",
    r"\bconfirmed (diagnosis|condition)\b",
)

MEDICATION_PATTERNS: tuple[str, ...] = (
    r"\b(take|taking|dose|dosage|tablets?|capsules?|pills?)\b[^.\n]{0,40}\b\d+(\.\d+)?\s?(mg|mcg|iu)\b",
    r"\b(take|try|start|use)\s+(an?\s+|some\s+)?(paracetamol|acetaminophen|ibuprofen|aspirin|antibiotics?|"
    r"antihistamines?|dolo|crocin|combiflam|azithromycin|amoxicillin|omeprazole|pantoprazole|cetirizine|"
    r"montelukast|metformin|antacids?|painkillers?)\b",
)


@dataclass(frozen=True)
class ScanResult:
    verdict: SafetyResult
    reason: str
    modified_response: str | None = None
    triage_flags: tuple[str, ...] = field(default_factory=tuple)


def _matches_any(text: str, patterns: tuple[str, ...]) -> str | None:
    for pattern in patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return pattern
    return None


def _append_note(response_text: str, note: str) -> str:
    if note in response_text:
        return response_text
    return response_text.rstrip() + "\n\n" + note


def _append_disclaimer(response_text: str) -> str:
    return _append_note(response_text, DISCLAIMER)


def scan_user_message(message: str) -> ScanResult:
    self_harm = _matches_any(message, SELF_HARM_PATTERNS)
    if self_harm is not None:
        return ScanResult(
            verdict=SafetyResult.BLOCK,
            reason=f"Self-harm language matched: {self_harm}",
            modified_response=CRISIS_MESSAGE,
        )

    emergency = _matches_any(message, EMERGENCY_PATTERNS)
    if emergency is not None:
        return ScanResult(
            verdict=SafetyResult.BLOCK,
            reason=f"Emergency keyword matched: {emergency}",
            modified_response=ESCALATION_MESSAGE,
        )

    if re.search(CHEST_SYMPTOM, message, flags=re.IGNORECASE):
        companion = _matches_any(message, CHEST_RED_FLAGS)
        if companion is not None:
            return ScanResult(
                verdict=SafetyResult.BLOCK,
                reason=f"Chest symptom with red flag: {companion}",
                modified_response=ESCALATION_MESSAGE,
            )

    flags = tuple(
        label for label, pattern in TRIAGE_PATTERNS.items() if re.search(pattern, message, flags=re.IGNORECASE)
    )
    if flags:
        return ScanResult(
            verdict=SafetyResult.FLAG,
            reason="Symptom needs careful triage: " + ", ".join(flags),
            triage_flags=flags,
        )

    return ScanResult(verdict=SafetyResult.PASS, reason="No emergency keywords detected")


def scan_ai_response(response_text: str) -> ScanResult:
    modified = response_text
    reasons: list[str] = []

    medication = _matches_any(response_text, MEDICATION_PATTERNS)
    if medication is not None:
        modified = _append_note(modified, NO_PRESCRIPTION_NOTE)
        reasons.append(f"Medication language detected: {medication}")

    response_without_notes = modified.replace(DISCLAIMER, "").replace(NO_PRESCRIPTION_NOTE, "")
    diagnosis = _matches_any(response_without_notes, DIAGNOSIS_PATTERNS)
    if diagnosis is not None:
        reasons.append(f"Diagnosis language detected: {diagnosis}")

    if DISCLAIMER not in modified:
        modified = _append_disclaimer(modified)
        reasons.append("Disclaimer missing")

    if reasons:
        return ScanResult(verdict=SafetyResult.FLAG, reason="; ".join(reasons), modified_response=modified)

    return ScanResult(verdict=SafetyResult.PASS, reason="OK", modified_response=response_text)


def apply_escalation_override(user_message: str, ai_response: str | None = None) -> ScanResult:
    user_scan = scan_user_message(user_message)
    if user_scan.verdict == SafetyResult.BLOCK:
        return user_scan

    if ai_response is not None:
        return scan_ai_response(ai_response)

    return user_scan
